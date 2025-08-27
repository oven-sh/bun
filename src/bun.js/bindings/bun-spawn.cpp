#include "root.h"

#if OS(LINUX)

#include <fcntl.h>
#include <cstring>
#include <string.h>
#include <signal.h>
#include <unistd.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <fcntl.h>
#include <signal.h>
#include <sys/syscall.h>
#include <sys/resource.h>
#include <sys/prctl.h>
#include <linux/sched.h>
#include <sched.h>
#include <errno.h>
#include <stdio.h>
#include <sys/types.h>
#include <sys/socket.h>
#include <sys/ioctl.h>
#include <sys/mount.h>
#include <libgen.h>
#include <net/if.h>
#include <linux/netlink.h>
#include <linux/rtnetlink.h>

extern char** environ;

#ifndef CLOSE_RANGE_CLOEXEC
#define CLOSE_RANGE_CLOEXEC (1U << 2)
#endif

// Define clone3 structures if not available in headers
#ifndef CLONE_ARGS_SIZE_VER0
struct clone_args {
    uint64_t flags;
    uint64_t pidfd;
    uint64_t child_tid;
    uint64_t parent_tid;
    uint64_t exit_signal;
    uint64_t stack;
    uint64_t stack_size;
    uint64_t tls;
    uint64_t set_tid;
    uint64_t set_tid_size;
    uint64_t cgroup;
};
#define CLONE_ARGS_SIZE_VER0 64
#endif

// Wrapper for clone3 syscall
static long clone3_wrapper(struct clone_args* cl_args, size_t size) {
    return syscall(__NR_clone3, cl_args, size);
}

extern "C" ssize_t bun_close_range(unsigned int start, unsigned int end, unsigned int flags);

enum FileActionType : uint8_t {
    None,
    Close,
    Dup2,
    Open,
};

typedef struct bun_spawn_request_file_action_t {
    FileActionType type;
    const char* path;
    int fds[2];
    int flags;
    int mode;
} bun_spawn_request_file_action_t;

typedef struct bun_spawn_file_action_list_t {
    const bun_spawn_request_file_action_t* ptr;
    size_t len;
} bun_spawn_file_action_list_t;

// Mount types for container filesystem isolation
enum bun_mount_type {
    MOUNT_TYPE_BIND = 0,
    MOUNT_TYPE_TMPFS = 1,
};

// Single mount configuration
typedef struct bun_mount_config_t {
    enum bun_mount_type type;
    const char* source;  // For bind mounts
    const char* target;
    bool readonly;
    uint64_t tmpfs_size;  // For tmpfs, 0 = default
} bun_mount_config_t;

// Container setup context passed between parent and child
typedef struct bun_container_setup_t {
    pid_t child_pid;  // Set by parent after clone3
    int sync_pipe_read;  // Child reads from this
    int sync_pipe_write; // Parent writes to this
    int error_pipe_read;  // Parent reads errors from this
    int error_pipe_write; // Child writes errors to this
    
    // UID/GID mapping for user namespaces
    bool has_uid_mapping;
    uint32_t uid_inside;
    uint32_t uid_outside;
    uint32_t uid_count;
    
    bool has_gid_mapping;
    uint32_t gid_inside;
    uint32_t gid_outside; 
    uint32_t gid_count;
    
    // Network namespace flag
    bool has_network_namespace;
    
    // Mount namespace configuration
    bool has_mount_namespace;
    const bun_mount_config_t* mounts;
    size_t mount_count;
    
    // Cgroup path if resource limits are set
    const char* cgroup_path;
    uint64_t memory_limit;
    uint32_t cpu_limit_pct;
} bun_container_setup_t;

typedef struct bun_spawn_request_t {
    const char* chdir;
    bool detached;
    bool set_pdeathsig;  // If true, child gets SIGKILL when parent dies
    bun_spawn_file_action_list_t actions;
    // Container namespace flags
    uint32_t namespace_flags;  // CLONE_NEW* flags for namespaces
    bun_container_setup_t* container_setup; // Container-specific setup data
} bun_spawn_request_t;

// Helper function to write UID/GID mappings for user namespace
static int write_id_mapping(pid_t child_pid, const char* map_file, 
                           uint32_t inside, uint32_t outside, uint32_t count) {
    char path[256];
    snprintf(path, sizeof(path), "/proc/%d/%s", child_pid, map_file);
    
    int fd = open(path, O_WRONLY | O_CLOEXEC);
    if (fd < 0) return -1;
    
    char mapping[128];
    int len = snprintf(mapping, sizeof(mapping), "%u %u %u\n", inside, outside, count);
    
    ssize_t written = write(fd, mapping, len);
    close(fd);
    
    return written == len ? 0 : -1;
}

// Helper to write "deny" to setgroups for user namespace
static int deny_setgroups(pid_t child_pid) {
    char path[256];
    snprintf(path, sizeof(path), "/proc/%d/setgroups", child_pid);
    
    int fd = open(path, O_WRONLY | O_CLOEXEC);
    if (fd < 0) return -1;
    
    ssize_t written = write(fd, "deny\n", 5);
    close(fd);
    
    return written == 5 ? 0 : -1;
}

// Helper to setup cgroup v2 for resource limits
static int setup_cgroup(const char* cgroup_path, pid_t child_pid, 
                        uint64_t memory_limit, uint32_t cpu_limit_pct) {
    char path[512];
    int fd;
    
    // For unprivileged containers, we need to use the user's delegated cgroup
    // Try to create under the current cgroup first
    char current_cgroup[512];
    FILE* cgroup_file = fopen("/proc/self/cgroup", "r");
    if (cgroup_file) {
        if (fgets(current_cgroup, sizeof(current_cgroup), cgroup_file)) {
            // Parse format: "0::/path/to/cgroup"
            char* cgroup_subpath = strchr(current_cgroup, ':');
            if (cgroup_subpath) {
                cgroup_subpath = strchr(cgroup_subpath + 1, ':');
                if (cgroup_subpath) {
                    cgroup_subpath++; // Skip the second colon
                    // Remove newline
                    char* newline = strchr(cgroup_subpath, '\n');
                    if (newline) *newline = '\0';
                    
                    // Try to create under user's cgroup
                    snprintf(path, sizeof(path), "/sys/fs/cgroup%s/%s", cgroup_subpath, cgroup_path);
                    if (mkdir(path, 0755) == 0 || errno == EEXIST) {
                        // Success - use this path
                        fclose(cgroup_file);
                        goto setup_cgroup_controls;
                    }
                }
            }
        }
        fclose(cgroup_file);
    }
    
    // Fallback: try to create directly under /sys/fs/cgroup (requires root)
    snprintf(path, sizeof(path), "/sys/fs/cgroup/%s", cgroup_path);
    if (mkdir(path, 0755) != 0 && errno != EEXIST) {
        // Cgroup creation failed - resource limits won't work
        // Don't fail the spawn, just skip cgroup setup
        return 0;
    }
    
setup_cgroup_controls:
    ;  // Label needs a statement
    // Store the base path for later use
    char base_path[512];
    strncpy(base_path, path, sizeof(base_path) - 1);
    base_path[sizeof(base_path) - 1] = '\0';
    
    // Add child PID to cgroup
    snprintf(path, sizeof(path), "%s/cgroup.procs", base_path);
    fd = open(path, O_WRONLY | O_CLOEXEC);
    if (fd < 0) return 0; // Skip if we can't add to cgroup
    
    char pid_str[32];
    int len = snprintf(pid_str, sizeof(pid_str), "%d\n", child_pid);
    if (write(fd, pid_str, len) != len) {
        int err = errno;
        close(fd);
        return err;
    }
    close(fd);
    
    // Set memory limit if specified
    if (memory_limit > 0) {
        snprintf(path, sizeof(path), "%s/memory.max", base_path);
        fd = open(path, O_WRONLY | O_CLOEXEC);
        if (fd >= 0) {
            char limit_str[32];
            len = snprintf(limit_str, sizeof(limit_str), "%lu\n", memory_limit);
            write(fd, limit_str, len);
            close(fd);
        }
    }
    
    // Set CPU limit if specified (percentage to cgroup2 format)
    if (cpu_limit_pct > 0 && cpu_limit_pct <= 100) {
        snprintf(path, sizeof(path), "%s/cpu.max", base_path);
        fd = open(path, O_WRONLY | O_CLOEXEC);
        if (fd >= 0) {
            // cgroup2 cpu.max format: "$MAX $PERIOD" in microseconds
            const uint32_t period = 100000; // 100ms period
            uint32_t max = (cpu_limit_pct * period) / 100;
            char cpu_str[64];
            len = snprintf(cpu_str, sizeof(cpu_str), "%u %u\n", max, period);
            write(fd, cpu_str, len);
            close(fd);
        }
    }
    
    return 0;
}

// Parent-side container setup after clone3
static int setup_container_parent(pid_t child_pid, bun_container_setup_t* setup) {
    if (!setup) return 0;
    
    setup->child_pid = child_pid;
    
    // Setup UID/GID mappings for user namespace
    if (setup->has_uid_mapping || setup->has_gid_mapping) {
        // Must write mappings before child continues
        if (setup->has_uid_mapping) {
            if (write_id_mapping(child_pid, "uid_map", 
                               setup->uid_inside, setup->uid_outside, setup->uid_count) != 0) {
                return errno;
            }
        }
        
        // Deny setgroups before gid_map
        if (deny_setgroups(child_pid) != 0) {
            // Ignore error as it may not be supported
        }
        
        if (setup->has_gid_mapping) {
            if (write_id_mapping(child_pid, "gid_map",
                               setup->gid_inside, setup->gid_outside, setup->gid_count) != 0) {
                return errno;
            }
        }
    }
    
    // Setup cgroups if needed
    if (setup->cgroup_path && (setup->memory_limit || setup->cpu_limit_pct)) {
        int cgroup_res = setup_cgroup(setup->cgroup_path, child_pid, 
                                      setup->memory_limit, setup->cpu_limit_pct);
        if (cgroup_res != 0) {
            // Log but don't fail - cgroups might not be available
            // In production, you might want to fail here
        }
    }
    
    // Signal child to continue
    char sync = '1';
    if (write(setup->sync_pipe_write, &sync, 1) != 1) {
        return errno;
    }
    
    return 0;
}

// Setup network namespace - bring up loopback interface
static int setup_network_namespace() {
    // Try with a regular AF_INET socket first (more compatible)
    int sock = socket(AF_INET, SOCK_DGRAM | SOCK_CLOEXEC, 0);
    if (sock < 0) {
        // Fallback to netlink socket
        sock = socket(AF_NETLINK, SOCK_RAW | SOCK_CLOEXEC, NETLINK_ROUTE);
        if (sock < 0) {
            return -1;
        }
    }
    
    // Bring up loopback interface using ioctl
    struct ifreq ifr;
    memset(&ifr, 0, sizeof(ifr));
    // Use strncpy for safety, ensuring null termination
    strncpy(ifr.ifr_name, "lo", IFNAMSIZ - 1);
    ifr.ifr_name[IFNAMSIZ - 1] = '\0';
    
    // Get current flags
    if (ioctl(sock, SIOCGIFFLAGS, &ifr) < 0) {
        close(sock);
        return -1;
    }
    
    // Set the UP flag
    ifr.ifr_flags |= IFF_UP | IFF_RUNNING;
    if (ioctl(sock, SIOCSIFFLAGS, &ifr) < 0) {
        close(sock);
        return -1;
    }
    
    close(sock);
    return 0;
}

// Helper to write error message to error pipe
static void write_error_to_pipe(int error_pipe_fd, const char* error_msg) {
    if (error_pipe_fd < 0) return;
    
    size_t len = strlen(error_msg);
    if (len > 255) len = 255; // Limit error message length
    
    // Write length byte followed by message
    unsigned char msg_len = (unsigned char)len;
    write(error_pipe_fd, &msg_len, 1);
    write(error_pipe_fd, error_msg, len);
}

// Setup bind mount
static int setup_bind_mount(const bun_mount_config_t* mnt) {
    if (!mnt->source || !mnt->target) {
        errno = EINVAL;
        return -1;
    }
    
    // Check if source exists
    struct stat st;
    if (stat(mnt->source, &st) != 0) {
        return -1;
    }
    
    // Create target if needed
    if (S_ISDIR(st.st_mode)) {
        // Create directory
        if (mkdir(mnt->target, 0755) != 0 && errno != EEXIST) {
            return -1;
        }
    } else {
        // For files, create parent directory and touch the file
        char* target_copy = strdup(mnt->target);
        if (!target_copy) {
            errno = ENOMEM;
            return -1;
        }
        
        char* parent = dirname(target_copy);
        // Create parent directories recursively
        char* p = parent;
        while (*p) {
            if (*p == '/') {
                *p = '\0';
                if (strlen(parent) > 0) {
                    mkdir(parent, 0755); // Ignore errors
                }
                *p = '/';
            }
            p++;
        }
        if (strlen(parent) > 0) {
            mkdir(parent, 0755); // Ignore errors
        }
        free(target_copy);
        
        // Touch the file
        int fd = open(mnt->target, O_CREAT | O_WRONLY | O_CLOEXEC, 0644);
        if (fd >= 0) {
            close(fd);
        }
    }
    
    // Perform the bind mount
    unsigned long flags = MS_BIND;
    if (mount(mnt->source, mnt->target, NULL, flags, NULL) != 0) {
        return -1;
    }
    
    // If readonly, remount with MS_RDONLY
    if (mnt->readonly) {
        flags = MS_BIND | MS_REMOUNT | MS_RDONLY;
        if (mount(NULL, mnt->target, NULL, flags, NULL) != 0) {
            // Non-fatal, mount succeeded but couldn't make it readonly
        }
    }
    
    return 0;
}

// Setup tmpfs mount
static int setup_tmpfs_mount(const bun_mount_config_t* mnt) {
    if (!mnt->target) {
        errno = EINVAL;
        return -1;
    }
    
    // Create target directory
    if (mkdir(mnt->target, 0755) != 0 && errno != EEXIST) {
        return -1;
    }
    
    // Prepare mount options
    char options[256] = "mode=0755";
    if (mnt->tmpfs_size > 0) {
        size_t len = strlen(options);
        snprintf(options + len, sizeof(options) - len, ",size=%lu", mnt->tmpfs_size);
    }
    
    // Mount tmpfs
    if (mount(NULL, mnt->target, "tmpfs", 0, options) != 0) {
        return -1;
    }
    
    return 0;
}

// Child-side container setup before exec
static int setup_container_child(bun_container_setup_t* setup) {
    if (!setup) return 0;
    
    // Wait for parent to complete setup
    char sync;
    if (read(setup->sync_pipe_read, &sync, 1) != 1) {
        write_error_to_pipe(setup->error_pipe_write, "Failed to sync with parent process");
        close(setup->error_pipe_write);
        return -1;
    }
    
    // Close pipes we don't need anymore
    close(setup->sync_pipe_read);
    close(setup->sync_pipe_write);
    close(setup->error_pipe_read);
    
    // Setup network if we have a network namespace
    if (setup->has_network_namespace) {
        int net_result = setup_network_namespace();
        if (net_result != 0) {
            // Write warning to error pipe but continue - network issues are non-fatal
            write_error_to_pipe(setup->error_pipe_write, 
                "Warning: Failed to configure loopback interface in network namespace");
            // Don't return error - let the process continue
        }
    }
    
    // Setup filesystem mounts if we have a mount namespace
    if (setup->has_mount_namespace && setup->mounts && setup->mount_count > 0) {
        for (size_t i = 0; i < setup->mount_count; i++) {
            const bun_mount_config_t* mnt = &setup->mounts[i];
            int mount_result = 0;
            
            switch (mnt->type) {
                case MOUNT_TYPE_BIND:
                    mount_result = setup_bind_mount(mnt);
                    break;
                case MOUNT_TYPE_TMPFS:
                    mount_result = setup_tmpfs_mount(mnt);
                    break;
            }
            
            if (mount_result != 0) {
                char error_msg[256];
                snprintf(error_msg, sizeof(error_msg), 
                    "Failed to mount %s: %s", mnt->target, strerror(errno));
                write_error_to_pipe(setup->error_pipe_write, error_msg);
                close(setup->error_pipe_write);
                return -1;
            }
        }
    }
    
    // Close error pipe if no errors
    close(setup->error_pipe_write);
    return 0;
}

extern "C" ssize_t posix_spawn_bun(
    int* pid,
    const char* path,
    const bun_spawn_request_t* request,
    char* const argv[],
    char* const envp[])
{
    volatile int status = 0;
    sigset_t blockall, oldmask;
    int res = 0, cs = 0;
    sigfillset(&blockall);
    sigprocmask(SIG_SETMASK, &blockall, &oldmask);
    pthread_setcancelstate(PTHREAD_CANCEL_DISABLE, &cs);
    
    const auto childFailed = [&]() -> ssize_t {
        res = errno;
        status = res;
        bun_close_range(0, ~0U, 0);
        _exit(127);

        // should never be reached
        return -1;
    };

    const auto startChild = [&]() -> ssize_t {
        sigset_t childmask = oldmask;
        
        // If we're in a container, wait for parent setup
        if (request->container_setup) {
            if (setup_container_child(request->container_setup) != 0) {
                return childFailed();
            }
        }

        // Reset signals
        struct sigaction sa = { 0 };
        sa.sa_handler = SIG_DFL;
        for (int i = 0; i < NSIG; i++) {
            sigaction(i, &sa, 0);
        }

        // Make "detached" work
        if (request->detached) {
            setsid();
        } else if (request->set_pdeathsig) {
            // Set death signal - child gets SIGKILL if parent dies
            // This is especially important for container processes to ensure cleanup
            prctl(PR_SET_PDEATHSIG, SIGKILL);
        }

        int current_max_fd = 0;

        if (request->chdir) {
            if (chdir(request->chdir) != 0) {
                return childFailed();
            }
        }

        const auto& actions = request->actions;

        for (size_t i = 0; i < actions.len; i++) {
            const bun_spawn_request_file_action_t& action = actions.ptr[i];
            switch (action.type) {
            case FileActionType::Close: {
                close(action.fds[0]);
                break;
            }
            case FileActionType::Dup2: {
                // Note: If oldfd is a valid file descriptor, and newfd has the same
                // value as oldfd, then dup2() does nothing, and returns newfd.
                if (action.fds[0] == action.fds[1]) {
                    int prevErrno = errno;
                    errno = 0;

                    // Remove the O_CLOEXEC flag
                    // If we don't do this, then the process will have an already-closed file descriptor
                    int mask = fcntl(action.fds[0], F_GETFD, 0);
                    mask &= ~FD_CLOEXEC;
                    fcntl(action.fds[0], F_SETFD, mask);

                    if (errno != 0) {
                        return childFailed();
                    }

                    // Restore errno
                    errno = prevErrno;
                } else {
                    // dup2 creates a new file descriptor without O_CLOEXEC set
                    if (dup2(action.fds[0], action.fds[1]) == -1) {
                        return childFailed();
                    }
                }

                current_max_fd = std::max(current_max_fd, action.fds[1]);
                break;
            }
            case FileActionType::Open: {
                int opened = -1;
                opened = open(action.path, action.flags, action.mode);

                if (opened == -1) {
                    return childFailed();
                }

                if (opened != -1) {
                    if (dup2(opened, action.fds[0]) == -1) {
                        close(opened);
                        return childFailed();
                    }
                    current_max_fd = std::max(current_max_fd, action.fds[0]);
                    if (close(opened)) {
                        return childFailed();
                    }
                }

                break;
            }
            default: {
                __builtin_unreachable();
                break;
            }
            }
        }

        sigprocmask(SIG_SETMASK, &childmask, 0);
        if (!envp)
            envp = environ;

        if (bun_close_range(current_max_fd + 1, ~0U, CLOSE_RANGE_CLOEXEC) != 0) {
            bun_close_range(current_max_fd + 1, ~0U, 0);
        }
        if (execve(path, argv, envp) == -1) {
            return childFailed();
        }
        _exit(127);

        // should never be reached.
        return -1;
    };

    pid_t child = -1;
    int sync_pipe[2] = {-1, -1};
    int error_pipe[2] = {-1, -1};
    
    // Use clone3 if we have namespace flags, otherwise use vfork for performance
    if (request->namespace_flags != 0 && request->container_setup) {
        // Create synchronization pipes
        if (pipe2(sync_pipe, O_CLOEXEC) != 0) {
            res = errno;
            goto cleanup;
        }
        if (pipe2(error_pipe, O_CLOEXEC) != 0) {
            res = errno;
            goto cleanup;
        }
        
        // Setup container context with pipes
        request->container_setup->sync_pipe_read = sync_pipe[0];
        request->container_setup->sync_pipe_write = sync_pipe[1];
        request->container_setup->error_pipe_read = error_pipe[0];
        request->container_setup->error_pipe_write = error_pipe[1];
        
        struct clone_args cl_args = {0};
        cl_args.flags = request->namespace_flags;
        cl_args.exit_signal = SIGCHLD;
        
        child = clone3_wrapper(&cl_args, CLONE_ARGS_SIZE_VER0);
        
        if (child == -1) {
            res = errno;
            // Don't fall back silently - report the error
            goto cleanup;
        }
    } else if (request->namespace_flags != 0) {
        // Container requested but no setup provided - this is an error
        res = EINVAL;
        goto cleanup;
    } else {
        child = vfork();
    }

    if (child == 0) {
        return startChild();
    }

    if (child != -1) {
        // Parent process - setup container if needed
        if (request->container_setup) {
            // Close child's ends of pipes
            close(sync_pipe[0]);
            close(error_pipe[1]);
            
            // Do parent-side container setup
            int setup_res = setup_container_parent(child, request->container_setup);
            if (setup_res != 0) {
                // Setup failed - kill child and return error
                kill(child, SIGKILL);
                wait4(child, 0, 0, 0);
                res = setup_res;
                goto cleanup;
            }
            
            // Check for errors/warnings from child
            unsigned char msg_len;
            ssize_t len_read = read(error_pipe[0], &msg_len, 1);
            if (len_read == 1 && msg_len > 0) {
                char error_buf[256];
                ssize_t error_len = read(error_pipe[0], error_buf, msg_len);
                if (error_len > 0) {
                    error_buf[error_len] = '\0';
                    // Check if it's a warning (non-fatal) or error
                    if (strncmp(error_buf, "Warning:", 8) == 0) {
                        // Log warning but don't fail - this could be logged to stderr
                        // For now, we'll just continue
                    } else {
                        // Fatal error - child setup failed
                        wait4(child, 0, 0, 0);
                        res = ECHILD; // Generic child error
                        goto cleanup;
                    }
                }
            }
        }
        
        res = status;

        if (!res) {
            if (pid) {
                *pid = child;
            }
        } else {
            wait4(child, 0, 0, 0);
        }
    } else {
        res = errno;
    }

cleanup:
    // Close all pipes if they were created
    if (sync_pipe[0] != -1) close(sync_pipe[0]);
    if (sync_pipe[1] != -1) close(sync_pipe[1]);
    if (error_pipe[0] != -1) close(error_pipe[0]);
    if (error_pipe[1] != -1) close(error_pipe[1]);
    
    sigprocmask(SIG_SETMASK, &oldmask, 0);
    pthread_setcancelstate(cs, 0);

    return res;
}

#endif

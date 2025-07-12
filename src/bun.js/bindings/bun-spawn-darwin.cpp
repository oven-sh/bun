#include "root.h"

#if OS(DARWIN)

#include <fcntl.h>
#include <cstring>
#include <signal.h>
#include <unistd.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <sys/resource.h>
#include <errno.h>
#include <stdlib.h>

extern char** environ;

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

typedef struct bun_spawn_request_t {
    const char* chdir;
    bool detached;
    bun_spawn_file_action_list_t actions;
    uint32_t uid;
    uint32_t gid;
    bool has_uid;
    bool has_gid;
} bun_spawn_request_t;

extern "C" ssize_t posix_spawn_bun(
    const bun_spawn_request_t* request,
    const char* path,
    char* const argv[],
    char* const envp[])
{
    // Check permissions before forking
    if (request->has_uid && request->uid != geteuid()) {
        if (geteuid() != 0) {
            errno = EPERM;
            return -EPERM;
        }
    }
    
    if (request->has_gid && request->gid != getegid()) {
        if (geteuid() != 0) {
            errno = EPERM;
            return -EPERM;
        }
    }
    
    pid_t pid;
    int saved_errno;
    sigset_t oldmask;
    sigset_t newmask;
    
    // Block all signals during fork to prevent signal handlers from running
    sigfillset(&newmask);
    sigprocmask(SIG_SETMASK, &newmask, &oldmask);
    
    pid = fork();
    saved_errno = errno;
    
    if (pid == 0) {
        // Child process
        
        // Restore signal mask in child
        sigprocmask(SIG_SETMASK, &oldmask, NULL);
        
        // Reset signal handlers to default
        struct sigaction sa;
        memset(&sa, 0, sizeof(sa));
        sa.sa_handler = SIG_DFL;
        sigemptyset(&sa.sa_mask);
        
        for (int i = 1; i < NSIG; i++) {
            // Skip SIGKILL and SIGSTOP as they can't be changed
            if (i == SIGKILL || i == SIGSTOP) continue;
            sigaction(i, &sa, NULL);
        }
        
        // Set up process session if detached
        if (request->detached) {
            setsid();
        }
        
        // Change directory if requested
        if (request->chdir) {
            if (chdir(request->chdir) != 0) {
                _exit(127);
            }
        }
        
        // Apply file actions
        for (size_t i = 0; i < request->actions.len; i++) {
            const bun_spawn_request_file_action_t* action = &request->actions.ptr[i];
            
            switch (action->type) {
                case Close:
                    close(action->fds[0]);
                    break;
                    
                case Dup2:
                    if (dup2(action->fds[0], action->fds[1]) < 0) {
                        _exit(127);
                    }
                    break;
                    
                case Open: {
                    int fd = open(action->path, action->flags, action->mode);
                    if (fd < 0) {
                        _exit(127);
                    }
                    if (fd != action->fds[0]) {
                        if (dup2(fd, action->fds[0]) < 0) {
                            _exit(127);
                        }
                        close(fd);
                    }
                    break;
                }
                
                default:
                    break;
            }
        }
        
        // Close all file descriptors above stderr except those we just set up
        int max_fd = getdtablesize();
        for (int fd = 3; fd < max_fd; fd++) {
            int flags = fcntl(fd, F_GETFD);
            if (flags >= 0 && (flags & FD_CLOEXEC)) {
                close(fd);
            }
        }
        
        // Set group id before user id (required order)
        if (request->has_gid) {
            if (setgid(request->gid) != 0) {
                _exit(127);
            }
        }
        
        if (request->has_uid) {
            if (setuid(request->uid) != 0) {
                _exit(127);
            }
        }
        
        // Execute the program
        if (!envp) {
            envp = environ;
        }
        
        execve(path, argv, envp);
        
        // If we get here, execve failed
        _exit(127);
    }
    
    // Parent process
    sigprocmask(SIG_SETMASK, &oldmask, NULL);
    
    if (pid < 0) {
        // Fork failed
        errno = saved_errno;
        return -1;
    }
    
    return pid;
}

#endif
// GENERATED CODE - DO NOT MODIFY BY HAND
#include "uv-posix-polyfills.h"

#if OS(LINUX) || OS(DARWIN)
UV_EXTERN int uv_accept(uv_stream_t* server, uv_stream_t* client)
{
    __bun_throw_not_implemented("uv_accept");
    __builtin_unreachable();
}

UV_EXTERN int uv_async_init(uv_loop_t*,
    uv_async_t* async,
    uv_async_cb async_cb)
{
    __bun_throw_not_implemented("uv_async_init");
    __builtin_unreachable();
}

UV_EXTERN int uv_async_send(uv_async_t* async)
{
    __bun_throw_not_implemented("uv_async_send");
    __builtin_unreachable();
}

UV_EXTERN unsigned int uv_available_parallelism(void)
{
    __bun_throw_not_implemented("uv_available_parallelism");
    __builtin_unreachable();
}

UV_EXTERN int uv_backend_fd(const uv_loop_t*)
{
    __bun_throw_not_implemented("uv_backend_fd");
    __builtin_unreachable();
}

UV_EXTERN int uv_backend_timeout(const uv_loop_t*)
{
    __bun_throw_not_implemented("uv_backend_timeout");
    __builtin_unreachable();
}

UV_EXTERN void uv_barrier_destroy(uv_barrier_t* barrier)
{
    __bun_throw_not_implemented("uv_barrier_destroy");
    __builtin_unreachable();
}

UV_EXTERN int uv_barrier_init(uv_barrier_t* barrier, unsigned int count)
{
    __bun_throw_not_implemented("uv_barrier_init");
    __builtin_unreachable();
}

UV_EXTERN int uv_barrier_wait(uv_barrier_t* barrier)
{
    __bun_throw_not_implemented("uv_barrier_wait");
    __builtin_unreachable();
}

UV_EXTERN uv_buf_t uv_buf_init(char* base, unsigned int len)
{
    __bun_throw_not_implemented("uv_buf_init");
    __builtin_unreachable();
}

UV_EXTERN int uv_cancel(uv_req_t* req)
{
    __bun_throw_not_implemented("uv_cancel");
    __builtin_unreachable();
}

UV_EXTERN int uv_chdir(const char* dir)
{
    __bun_throw_not_implemented("uv_chdir");
    __builtin_unreachable();
}

UV_EXTERN int uv_check_init(uv_loop_t*, uv_check_t* check)
{
    __bun_throw_not_implemented("uv_check_init");
    __builtin_unreachable();
}

UV_EXTERN int uv_check_start(uv_check_t* check, uv_check_cb cb)
{
    __bun_throw_not_implemented("uv_check_start");
    __builtin_unreachable();
}

UV_EXTERN int uv_check_stop(uv_check_t* check)
{
    __bun_throw_not_implemented("uv_check_stop");
    __builtin_unreachable();
}

UV_EXTERN int uv_clock_gettime(uv_clock_id clock_id, uv_timespec64_t* ts)
{
    __bun_throw_not_implemented("uv_clock_gettime");
    __builtin_unreachable();
}

UV_EXTERN void uv_close(uv_handle_t* handle, uv_close_cb close_cb)
{
    __bun_throw_not_implemented("uv_close");
    __builtin_unreachable();
}

UV_EXTERN void uv_cond_broadcast(uv_cond_t* cond)
{
    __bun_throw_not_implemented("uv_cond_broadcast");
    __builtin_unreachable();
}

UV_EXTERN void uv_cond_destroy(uv_cond_t* cond)
{
    __bun_throw_not_implemented("uv_cond_destroy");
    __builtin_unreachable();
}

UV_EXTERN int uv_cond_init(uv_cond_t* cond)
{
    __bun_throw_not_implemented("uv_cond_init");
    __builtin_unreachable();
}

UV_EXTERN void uv_cond_signal(uv_cond_t* cond)
{
    __bun_throw_not_implemented("uv_cond_signal");
    __builtin_unreachable();
}

UV_EXTERN int uv_cond_timedwait(uv_cond_t* cond,
    uv_mutex_t* mutex,
    uint64_t timeout)
{
    __bun_throw_not_implemented("uv_cond_timedwait");
    __builtin_unreachable();
}

UV_EXTERN void uv_cond_wait(uv_cond_t* cond, uv_mutex_t* mutex)
{
    __bun_throw_not_implemented("uv_cond_wait");
    __builtin_unreachable();
}

UV_EXTERN int uv_cpu_info(uv_cpu_info_t** cpu_infos, int* count)
{
    __bun_throw_not_implemented("uv_cpu_info");
    __builtin_unreachable();
}

UV_EXTERN int uv_cpumask_size(void)
{
    __bun_throw_not_implemented("uv_cpumask_size");
    __builtin_unreachable();
}

UV_EXTERN int uv_cwd(char* buffer, size_t* size)
{
    __bun_throw_not_implemented("uv_cwd");
    __builtin_unreachable();
}

UV_EXTERN uv_loop_t* uv_default_loop(void)
{
    __bun_throw_not_implemented("uv_default_loop");
    __builtin_unreachable();
}

UV_EXTERN void uv_disable_stdio_inheritance(void)
{
    __bun_throw_not_implemented("uv_disable_stdio_inheritance");
    __builtin_unreachable();
}

UV_EXTERN void uv_dlclose(uv_lib_t* lib)
{
    __bun_throw_not_implemented("uv_dlclose");
    __builtin_unreachable();
}

UV_EXTERN const char* uv_dlerror(const uv_lib_t* lib)
{
    __bun_throw_not_implemented("uv_dlerror");
    __builtin_unreachable();
}

UV_EXTERN int uv_dlopen(const char* filename, uv_lib_t* lib)
{
    __bun_throw_not_implemented("uv_dlopen");
    __builtin_unreachable();
}

UV_EXTERN int uv_dlsym(uv_lib_t* lib, const char* name, void** ptr)
{
    __bun_throw_not_implemented("uv_dlsym");
    __builtin_unreachable();
}

UV_EXTERN const char* uv_err_name(int err)
{
    __bun_throw_not_implemented("uv_err_name");
    __builtin_unreachable();
}

UV_EXTERN char* uv_err_name_r(int err, char* buf, size_t buflen)
{
    __bun_throw_not_implemented("uv_err_name_r");
    __builtin_unreachable();
}

UV_EXTERN int uv_exepath(char* buffer, size_t* size)
{
    __bun_throw_not_implemented("uv_exepath");
    __builtin_unreachable();
}

UV_EXTERN int uv_fileno(const uv_handle_t* handle, uv_os_fd_t* fd)
{
    __bun_throw_not_implemented("uv_fileno");
    __builtin_unreachable();
}

UV_EXTERN void uv_free_cpu_info(uv_cpu_info_t* cpu_infos, int count)
{
    __bun_throw_not_implemented("uv_free_cpu_info");
    __builtin_unreachable();
}

UV_EXTERN void uv_free_interface_addresses(uv_interface_address_t* addresses,
    int count)
{
    __bun_throw_not_implemented("uv_free_interface_addresses");
    __builtin_unreachable();
}

UV_EXTERN void uv_freeaddrinfo(struct addrinfo* ai)
{
    __bun_throw_not_implemented("uv_freeaddrinfo");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_access(uv_loop_t* loop,
    uv_fs_t* req,
    const char* path,
    int mode,
    uv_fs_cb cb)
{
    __bun_throw_not_implemented("uv_fs_access");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_chmod(uv_loop_t* loop,
    uv_fs_t* req,
    const char* path,
    int mode,
    uv_fs_cb cb)
{
    __bun_throw_not_implemented("uv_fs_chmod");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_chown(uv_loop_t* loop,
    uv_fs_t* req,
    const char* path,
    uv_uid_t uid,
    uv_gid_t gid,
    uv_fs_cb cb)
{
    __bun_throw_not_implemented("uv_fs_chown");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_close(uv_loop_t* loop,
    uv_fs_t* req,
    uv_file file,
    uv_fs_cb cb)
{
    __bun_throw_not_implemented("uv_fs_close");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_closedir(uv_loop_t* loop,
    uv_fs_t* req,
    uv_dir_t* dir,
    uv_fs_cb cb)
{
    __bun_throw_not_implemented("uv_fs_closedir");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_copyfile(uv_loop_t* loop,
    uv_fs_t* req,
    const char* path,
    const char* new_path,
    int flags,
    uv_fs_cb cb)
{
    __bun_throw_not_implemented("uv_fs_copyfile");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_event_getpath(uv_fs_event_t* handle,
    char* buffer,
    size_t* size)
{
    __bun_throw_not_implemented("uv_fs_event_getpath");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_event_init(uv_loop_t* loop, uv_fs_event_t* handle)
{
    __bun_throw_not_implemented("uv_fs_event_init");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_event_start(uv_fs_event_t* handle,
    uv_fs_event_cb cb,
    const char* path,
    unsigned int flags)
{
    __bun_throw_not_implemented("uv_fs_event_start");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_event_stop(uv_fs_event_t* handle)
{
    __bun_throw_not_implemented("uv_fs_event_stop");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_fchmod(uv_loop_t* loop,
    uv_fs_t* req,
    uv_file file,
    int mode,
    uv_fs_cb cb)
{
    __bun_throw_not_implemented("uv_fs_fchmod");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_fchown(uv_loop_t* loop,
    uv_fs_t* req,
    uv_file file,
    uv_uid_t uid,
    uv_gid_t gid,
    uv_fs_cb cb)
{
    __bun_throw_not_implemented("uv_fs_fchown");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_fdatasync(uv_loop_t* loop,
    uv_fs_t* req,
    uv_file file,
    uv_fs_cb cb)
{
    __bun_throw_not_implemented("uv_fs_fdatasync");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_fstat(uv_loop_t* loop,
    uv_fs_t* req,
    uv_file file,
    uv_fs_cb cb)
{
    __bun_throw_not_implemented("uv_fs_fstat");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_fsync(uv_loop_t* loop,
    uv_fs_t* req,
    uv_file file,
    uv_fs_cb cb)
{
    __bun_throw_not_implemented("uv_fs_fsync");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_ftruncate(uv_loop_t* loop,
    uv_fs_t* req,
    uv_file file,
    int64_t offset,
    uv_fs_cb cb)
{
    __bun_throw_not_implemented("uv_fs_ftruncate");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_futime(uv_loop_t* loop,
    uv_fs_t* req,
    uv_file file,
    double atime,
    double mtime,
    uv_fs_cb cb)
{
    __bun_throw_not_implemented("uv_fs_futime");
    __builtin_unreachable();
}

UV_EXTERN const char* uv_fs_get_path(const uv_fs_t*)
{
    __bun_throw_not_implemented("uv_fs_get_path");
    __builtin_unreachable();
}

UV_EXTERN void* uv_fs_get_ptr(const uv_fs_t*)
{
    __bun_throw_not_implemented("uv_fs_get_ptr");
    __builtin_unreachable();
}

UV_EXTERN ssize_t uv_fs_get_result(const uv_fs_t*)
{
    __bun_throw_not_implemented("uv_fs_get_result");
    __builtin_unreachable();
}

UV_EXTERN uv_stat_t* uv_fs_get_statbuf(uv_fs_t*)
{
    __bun_throw_not_implemented("uv_fs_get_statbuf");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_get_system_error(const uv_fs_t*)
{
    __bun_throw_not_implemented("uv_fs_get_system_error");
    __builtin_unreachable();
}

UV_EXTERN uv_fs_type uv_fs_get_type(const uv_fs_t*)
{
    __bun_throw_not_implemented("uv_fs_get_type");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_lchown(uv_loop_t* loop,
    uv_fs_t* req,
    const char* path,
    uv_uid_t uid,
    uv_gid_t gid,
    uv_fs_cb cb)
{
    __bun_throw_not_implemented("uv_fs_lchown");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_link(uv_loop_t* loop,
    uv_fs_t* req,
    const char* path,
    const char* new_path,
    uv_fs_cb cb)
{
    __bun_throw_not_implemented("uv_fs_link");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_lstat(uv_loop_t* loop,
    uv_fs_t* req,
    const char* path,
    uv_fs_cb cb)
{
    __bun_throw_not_implemented("uv_fs_lstat");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_lutime(uv_loop_t* loop,
    uv_fs_t* req,
    const char* path,
    double atime,
    double mtime,
    uv_fs_cb cb)
{
    __bun_throw_not_implemented("uv_fs_lutime");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_mkdir(uv_loop_t* loop,
    uv_fs_t* req,
    const char* path,
    int mode,
    uv_fs_cb cb)
{
    __bun_throw_not_implemented("uv_fs_mkdir");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_mkdtemp(uv_loop_t* loop,
    uv_fs_t* req,
    const char* tpl,
    uv_fs_cb cb)
{
    __bun_throw_not_implemented("uv_fs_mkdtemp");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_mkstemp(uv_loop_t* loop,
    uv_fs_t* req,
    const char* tpl,
    uv_fs_cb cb)
{
    __bun_throw_not_implemented("uv_fs_mkstemp");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_open(uv_loop_t* loop,
    uv_fs_t* req,
    const char* path,
    int flags,
    int mode,
    uv_fs_cb cb)
{
    __bun_throw_not_implemented("uv_fs_open");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_opendir(uv_loop_t* loop,
    uv_fs_t* req,
    const char* path,
    uv_fs_cb cb)
{
    __bun_throw_not_implemented("uv_fs_opendir");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_poll_getpath(uv_fs_poll_t* handle,
    char* buffer,
    size_t* size)
{
    __bun_throw_not_implemented("uv_fs_poll_getpath");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_poll_init(uv_loop_t* loop, uv_fs_poll_t* handle)
{
    __bun_throw_not_implemented("uv_fs_poll_init");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_poll_start(uv_fs_poll_t* handle,
    uv_fs_poll_cb poll_cb,
    const char* path,
    unsigned int interval)
{
    __bun_throw_not_implemented("uv_fs_poll_start");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_poll_stop(uv_fs_poll_t* handle)
{
    __bun_throw_not_implemented("uv_fs_poll_stop");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_read(uv_loop_t* loop,
    uv_fs_t* req,
    uv_file file,
    const uv_buf_t bufs[],
    unsigned int nbufs,
    int64_t offset,
    uv_fs_cb cb)
{
    __bun_throw_not_implemented("uv_fs_read");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_readdir(uv_loop_t* loop,
    uv_fs_t* req,
    uv_dir_t* dir,
    uv_fs_cb cb)
{
    __bun_throw_not_implemented("uv_fs_readdir");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_readlink(uv_loop_t* loop,
    uv_fs_t* req,
    const char* path,
    uv_fs_cb cb)
{
    __bun_throw_not_implemented("uv_fs_readlink");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_realpath(uv_loop_t* loop,
    uv_fs_t* req,
    const char* path,
    uv_fs_cb cb)
{
    __bun_throw_not_implemented("uv_fs_realpath");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_rename(uv_loop_t* loop,
    uv_fs_t* req,
    const char* path,
    const char* new_path,
    uv_fs_cb cb)
{
    __bun_throw_not_implemented("uv_fs_rename");
    __builtin_unreachable();
}

UV_EXTERN void uv_fs_req_cleanup(uv_fs_t* req)
{
    __bun_throw_not_implemented("uv_fs_req_cleanup");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_rmdir(uv_loop_t* loop,
    uv_fs_t* req,
    const char* path,
    uv_fs_cb cb)
{
    __bun_throw_not_implemented("uv_fs_rmdir");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_scandir(uv_loop_t* loop,
    uv_fs_t* req,
    const char* path,
    int flags,
    uv_fs_cb cb)
{
    __bun_throw_not_implemented("uv_fs_scandir");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_scandir_next(uv_fs_t* req,
    uv_dirent_t* ent)
{
    __bun_throw_not_implemented("uv_fs_scandir_next");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_sendfile(uv_loop_t* loop,
    uv_fs_t* req,
    uv_file out_fd,
    uv_file in_fd,
    int64_t in_offset,
    size_t length,
    uv_fs_cb cb)
{
    __bun_throw_not_implemented("uv_fs_sendfile");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_stat(uv_loop_t* loop,
    uv_fs_t* req,
    const char* path,
    uv_fs_cb cb)
{
    __bun_throw_not_implemented("uv_fs_stat");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_statfs(uv_loop_t* loop,
    uv_fs_t* req,
    const char* path,
    uv_fs_cb cb)
{
    __bun_throw_not_implemented("uv_fs_statfs");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_symlink(uv_loop_t* loop,
    uv_fs_t* req,
    const char* path,
    const char* new_path,
    int flags,
    uv_fs_cb cb)
{
    __bun_throw_not_implemented("uv_fs_symlink");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_unlink(uv_loop_t* loop,
    uv_fs_t* req,
    const char* path,
    uv_fs_cb cb)
{
    __bun_throw_not_implemented("uv_fs_unlink");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_utime(uv_loop_t* loop,
    uv_fs_t* req,
    const char* path,
    double atime,
    double mtime,
    uv_fs_cb cb)
{
    __bun_throw_not_implemented("uv_fs_utime");
    __builtin_unreachable();
}

UV_EXTERN int uv_fs_write(uv_loop_t* loop,
    uv_fs_t* req,
    uv_file file,
    const uv_buf_t bufs[],
    unsigned int nbufs,
    int64_t offset,
    uv_fs_cb cb)
{
    __bun_throw_not_implemented("uv_fs_write");
    __builtin_unreachable();
}

UV_EXTERN uint64_t uv_get_available_memory(void)
{
    __bun_throw_not_implemented("uv_get_available_memory");
    __builtin_unreachable();
}

UV_EXTERN uint64_t uv_get_constrained_memory(void)
{
    __bun_throw_not_implemented("uv_get_constrained_memory");
    __builtin_unreachable();
}

UV_EXTERN uint64_t uv_get_free_memory(void)
{
    __bun_throw_not_implemented("uv_get_free_memory");
    __builtin_unreachable();
}

UV_EXTERN uv_os_fd_t uv_get_osfhandle(int fd)
{
    __bun_throw_not_implemented("uv_get_osfhandle");
    __builtin_unreachable();
}

UV_EXTERN int uv_get_process_title(char* buffer, size_t size)
{
    __bun_throw_not_implemented("uv_get_process_title");
    __builtin_unreachable();
}

UV_EXTERN uint64_t uv_get_total_memory(void)
{
    __bun_throw_not_implemented("uv_get_total_memory");
    __builtin_unreachable();
}

UV_EXTERN int uv_getaddrinfo(uv_loop_t* loop,
    uv_getaddrinfo_t* req,
    uv_getaddrinfo_cb getaddrinfo_cb,
    const char* node,
    const char* service,
    const struct addrinfo* hints)
{
    __bun_throw_not_implemented("uv_getaddrinfo");
    __builtin_unreachable();
}

UV_EXTERN int uv_getnameinfo(uv_loop_t* loop,
    uv_getnameinfo_t* req,
    uv_getnameinfo_cb getnameinfo_cb,
    const struct sockaddr* addr,
    int flags)
{
    __bun_throw_not_implemented("uv_getnameinfo");
    __builtin_unreachable();
}

UV_EXTERN int uv_getrusage(uv_rusage_t* rusage)
{
    __bun_throw_not_implemented("uv_getrusage");
    __builtin_unreachable();
}

UV_EXTERN int uv_getrusage_thread(uv_rusage_t* rusage)
{
    __bun_throw_not_implemented("uv_getrusage_thread");
    __builtin_unreachable();
}

UV_EXTERN int uv_gettimeofday(uv_timeval64_t* tv)
{
    __bun_throw_not_implemented("uv_gettimeofday");
    __builtin_unreachable();
}

UV_EXTERN uv_handle_type uv_guess_handle(uv_file file)
{
    __bun_throw_not_implemented("uv_guess_handle");
    __builtin_unreachable();
}

UV_EXTERN void* uv_handle_get_data(const uv_handle_t* handle)
{
    __bun_throw_not_implemented("uv_handle_get_data");
    __builtin_unreachable();
}

UV_EXTERN uv_loop_t* uv_handle_get_loop(const uv_handle_t* handle)
{
    __bun_throw_not_implemented("uv_handle_get_loop");
    __builtin_unreachable();
}

UV_EXTERN uv_handle_type uv_handle_get_type(const uv_handle_t* handle)
{
    __bun_throw_not_implemented("uv_handle_get_type");
    __builtin_unreachable();
}

UV_EXTERN void uv_handle_set_data(uv_handle_t* handle, void* data)
{
    __bun_throw_not_implemented("uv_handle_set_data");
    __builtin_unreachable();
}

UV_EXTERN size_t uv_handle_size(uv_handle_type type)
{
    __bun_throw_not_implemented("uv_handle_size");
    __builtin_unreachable();
}

UV_EXTERN const char* uv_handle_type_name(uv_handle_type type)
{
    __bun_throw_not_implemented("uv_handle_type_name");
    __builtin_unreachable();
}

UV_EXTERN int uv_has_ref(const uv_handle_t*)
{
    __bun_throw_not_implemented("uv_has_ref");
    __builtin_unreachable();
}

UV_EXTERN int uv_idle_init(uv_loop_t*, uv_idle_t* idle)
{
    __bun_throw_not_implemented("uv_idle_init");
    __builtin_unreachable();
}

UV_EXTERN int uv_idle_start(uv_idle_t* idle, uv_idle_cb cb)
{
    __bun_throw_not_implemented("uv_idle_start");
    __builtin_unreachable();
}

UV_EXTERN int uv_idle_stop(uv_idle_t* idle)
{
    __bun_throw_not_implemented("uv_idle_stop");
    __builtin_unreachable();
}

UV_EXTERN int uv_if_indextoiid(unsigned int ifindex,
    char* buffer,
    size_t* size)
{
    __bun_throw_not_implemented("uv_if_indextoiid");
    __builtin_unreachable();
}

UV_EXTERN int uv_if_indextoname(unsigned int ifindex,
    char* buffer,
    size_t* size)
{
    __bun_throw_not_implemented("uv_if_indextoname");
    __builtin_unreachable();
}

UV_EXTERN int uv_inet_ntop(int af, const void* src, char* dst, size_t size)
{
    __bun_throw_not_implemented("uv_inet_ntop");
    __builtin_unreachable();
}

UV_EXTERN int uv_inet_pton(int af, const char* src, void* dst)
{
    __bun_throw_not_implemented("uv_inet_pton");
    __builtin_unreachable();
}

UV_EXTERN int uv_interface_addresses(uv_interface_address_t** addresses,
    int* count)
{
    __bun_throw_not_implemented("uv_interface_addresses");
    __builtin_unreachable();
}

UV_EXTERN int uv_ip4_addr(const char* ip, int port, struct sockaddr_in* addr)
{
    __bun_throw_not_implemented("uv_ip4_addr");
    __builtin_unreachable();
}

UV_EXTERN int uv_ip4_name(const struct sockaddr_in* src, char* dst, size_t size)
{
    __bun_throw_not_implemented("uv_ip4_name");
    __builtin_unreachable();
}

UV_EXTERN int uv_ip6_addr(const char* ip, int port, struct sockaddr_in6* addr)
{
    __bun_throw_not_implemented("uv_ip6_addr");
    __builtin_unreachable();
}

UV_EXTERN int uv_ip6_name(const struct sockaddr_in6* src, char* dst, size_t size)
{
    __bun_throw_not_implemented("uv_ip6_name");
    __builtin_unreachable();
}

UV_EXTERN int uv_ip_name(const struct sockaddr* src, char* dst, size_t size)
{
    __bun_throw_not_implemented("uv_ip_name");
    __builtin_unreachable();
}

UV_EXTERN int uv_is_active(const uv_handle_t* handle)
{
    __bun_throw_not_implemented("uv_is_active");
    __builtin_unreachable();
}

UV_EXTERN int uv_is_closing(const uv_handle_t* handle)
{
    __bun_throw_not_implemented("uv_is_closing");
    __builtin_unreachable();
}

UV_EXTERN int uv_is_readable(const uv_stream_t* handle)
{
    __bun_throw_not_implemented("uv_is_readable");
    __builtin_unreachable();
}

UV_EXTERN int uv_is_writable(const uv_stream_t* handle)
{
    __bun_throw_not_implemented("uv_is_writable");
    __builtin_unreachable();
}

UV_EXTERN int uv_key_create(uv_key_t* key)
{
    __bun_throw_not_implemented("uv_key_create");
    __builtin_unreachable();
}

UV_EXTERN void uv_key_delete(uv_key_t* key)
{
    __bun_throw_not_implemented("uv_key_delete");
    __builtin_unreachable();
}

UV_EXTERN void* uv_key_get(uv_key_t* key)
{
    __bun_throw_not_implemented("uv_key_get");
    __builtin_unreachable();
}

UV_EXTERN void uv_key_set(uv_key_t* key, void* value)
{
    __bun_throw_not_implemented("uv_key_set");
    __builtin_unreachable();
}

UV_EXTERN int uv_kill(int pid, int signum)
{
    __bun_throw_not_implemented("uv_kill");
    __builtin_unreachable();
}

UV_EXTERN void uv_library_shutdown(void)
{
    __bun_throw_not_implemented("uv_library_shutdown");
    __builtin_unreachable();
}

UV_EXTERN int uv_listen(uv_stream_t* stream, int backlog, uv_connection_cb cb)
{
    __bun_throw_not_implemented("uv_listen");
    __builtin_unreachable();
}

UV_EXTERN void uv_loadavg(double avg[3])
{
    __bun_throw_not_implemented("uv_loadavg");
    __builtin_unreachable();
}

UV_EXTERN int uv_loop_alive(const uv_loop_t* loop)
{
    __bun_throw_not_implemented("uv_loop_alive");
    __builtin_unreachable();
}

UV_EXTERN int uv_loop_close(uv_loop_t* loop)
{
    __bun_throw_not_implemented("uv_loop_close");
    __builtin_unreachable();
}

UV_EXTERN int uv_loop_configure(uv_loop_t* loop, uv_loop_option option, ...)
{
    __bun_throw_not_implemented("uv_loop_configure");
    __builtin_unreachable();
}

UV_EXTERN void uv_loop_delete(uv_loop_t*)
{
    __bun_throw_not_implemented("uv_loop_delete");
    __builtin_unreachable();
}

UV_EXTERN int uv_loop_fork(uv_loop_t* loop)
{
    __bun_throw_not_implemented("uv_loop_fork");
    __builtin_unreachable();
}

UV_EXTERN void* uv_loop_get_data(const uv_loop_t*)
{
    __bun_throw_not_implemented("uv_loop_get_data");
    __builtin_unreachable();
}

UV_EXTERN int uv_loop_init(uv_loop_t* loop)
{
    __bun_throw_not_implemented("uv_loop_init");
    __builtin_unreachable();
}

UV_EXTERN uv_loop_t* uv_loop_new(void)
{
    __bun_throw_not_implemented("uv_loop_new");
    __builtin_unreachable();
}

UV_EXTERN void uv_loop_set_data(uv_loop_t*, void* data)
{
    __bun_throw_not_implemented("uv_loop_set_data");
    __builtin_unreachable();
}

UV_EXTERN size_t uv_loop_size(void)
{
    __bun_throw_not_implemented("uv_loop_size");
    __builtin_unreachable();
}

UV_EXTERN uint64_t uv_metrics_idle_time(uv_loop_t* loop)
{
    __bun_throw_not_implemented("uv_metrics_idle_time");
    __builtin_unreachable();
}

UV_EXTERN int uv_metrics_info(uv_loop_t* loop, uv_metrics_t* metrics)
{
    __bun_throw_not_implemented("uv_metrics_info");
    __builtin_unreachable();
}

UV_EXTERN uint64_t uv_now(const uv_loop_t*)
{
    __bun_throw_not_implemented("uv_now");
    __builtin_unreachable();
}

UV_EXTERN int uv_open_osfhandle(uv_os_fd_t os_fd)
{
    __bun_throw_not_implemented("uv_open_osfhandle");
    __builtin_unreachable();
}

UV_EXTERN int uv_os_environ(uv_env_item_t** envitems, int* count)
{
    __bun_throw_not_implemented("uv_os_environ");
    __builtin_unreachable();
}

UV_EXTERN void uv_os_free_environ(uv_env_item_t* envitems, int count)
{
    __bun_throw_not_implemented("uv_os_free_environ");
    __builtin_unreachable();
}

UV_EXTERN void uv_os_free_group(uv_group_t* grp)
{
    __bun_throw_not_implemented("uv_os_free_group");
    __builtin_unreachable();
}

UV_EXTERN void uv_os_free_passwd(uv_passwd_t* pwd)
{
    __bun_throw_not_implemented("uv_os_free_passwd");
    __builtin_unreachable();
}

UV_EXTERN int uv_os_get_group(uv_group_t* grp, uv_uid_t gid)
{
    __bun_throw_not_implemented("uv_os_get_group");
    __builtin_unreachable();
}

UV_EXTERN int uv_os_get_passwd(uv_passwd_t* pwd)
{
    __bun_throw_not_implemented("uv_os_get_passwd");
    __builtin_unreachable();
}

UV_EXTERN int uv_os_get_passwd2(uv_passwd_t* pwd, uv_uid_t uid)
{
    __bun_throw_not_implemented("uv_os_get_passwd2");
    __builtin_unreachable();
}

UV_EXTERN int uv_os_getenv(const char* name, char* buffer, size_t* size)
{
    __bun_throw_not_implemented("uv_os_getenv");
    __builtin_unreachable();
}

UV_EXTERN int uv_os_gethostname(char* buffer, size_t* size)
{
    __bun_throw_not_implemented("uv_os_gethostname");
    __builtin_unreachable();
}

UV_EXTERN int uv_os_getpriority(uv_pid_t pid, int* priority)
{
    __bun_throw_not_implemented("uv_os_getpriority");
    __builtin_unreachable();
}

UV_EXTERN int uv_os_homedir(char* buffer, size_t* size)
{
    __bun_throw_not_implemented("uv_os_homedir");
    __builtin_unreachable();
}

UV_EXTERN int uv_os_setenv(const char* name, const char* value)
{
    __bun_throw_not_implemented("uv_os_setenv");
    __builtin_unreachable();
}

UV_EXTERN int uv_os_setpriority(uv_pid_t pid, int priority)
{
    __bun_throw_not_implemented("uv_os_setpriority");
    __builtin_unreachable();
}

UV_EXTERN int uv_os_tmpdir(char* buffer, size_t* size)
{
    __bun_throw_not_implemented("uv_os_tmpdir");
    __builtin_unreachable();
}

UV_EXTERN int uv_os_uname(uv_utsname_t* buffer)
{
    __bun_throw_not_implemented("uv_os_uname");
    __builtin_unreachable();
}

UV_EXTERN int uv_os_unsetenv(const char* name)
{
    __bun_throw_not_implemented("uv_os_unsetenv");
    __builtin_unreachable();
}

UV_EXTERN int uv_pipe(uv_file fds[2], int read_flags, int write_flags)
{
    __bun_throw_not_implemented("uv_pipe");
    __builtin_unreachable();
}

UV_EXTERN int uv_pipe_bind(uv_pipe_t* handle, const char* name)
{
    __bun_throw_not_implemented("uv_pipe_bind");
    __builtin_unreachable();
}

UV_EXTERN int uv_pipe_bind2(uv_pipe_t* handle,
    const char* name,
    size_t namelen,
    unsigned int flags)
{
    __bun_throw_not_implemented("uv_pipe_bind2");
    __builtin_unreachable();
}

UV_EXTERN int uv_pipe_chmod(uv_pipe_t* handle, int flags)
{
    __bun_throw_not_implemented("uv_pipe_chmod");
    __builtin_unreachable();
}

UV_EXTERN void uv_pipe_connect(uv_connect_t* req,
    uv_pipe_t* handle,
    const char* name,
    uv_connect_cb cb)
{
    __bun_throw_not_implemented("uv_pipe_connect");
    __builtin_unreachable();
}

UV_EXTERN int uv_pipe_connect2(uv_connect_t* req,
    uv_pipe_t* handle,
    const char* name,
    size_t namelen,
    unsigned int flags,
    uv_connect_cb cb)
{
    __bun_throw_not_implemented("uv_pipe_connect2");
    __builtin_unreachable();
}

UV_EXTERN int uv_pipe_getpeername(const uv_pipe_t* handle,
    char* buffer,
    size_t* size)
{
    __bun_throw_not_implemented("uv_pipe_getpeername");
    __builtin_unreachable();
}

UV_EXTERN int uv_pipe_getsockname(const uv_pipe_t* handle,
    char* buffer,
    size_t* size)
{
    __bun_throw_not_implemented("uv_pipe_getsockname");
    __builtin_unreachable();
}

UV_EXTERN int uv_pipe_init(uv_loop_t*, uv_pipe_t* handle, int ipc)
{
    __bun_throw_not_implemented("uv_pipe_init");
    __builtin_unreachable();
}

UV_EXTERN int uv_pipe_open(uv_pipe_t*, uv_file file)
{
    __bun_throw_not_implemented("uv_pipe_open");
    __builtin_unreachable();
}

UV_EXTERN int uv_pipe_pending_count(uv_pipe_t* handle)
{
    __bun_throw_not_implemented("uv_pipe_pending_count");
    __builtin_unreachable();
}

UV_EXTERN void uv_pipe_pending_instances(uv_pipe_t* handle, int count)
{
    __bun_throw_not_implemented("uv_pipe_pending_instances");
    __builtin_unreachable();
}

UV_EXTERN uv_handle_type uv_pipe_pending_type(uv_pipe_t* handle)
{
    __bun_throw_not_implemented("uv_pipe_pending_type");
    __builtin_unreachable();
}

UV_EXTERN int uv_poll_init(uv_loop_t* loop, uv_poll_t* handle, int fd)
{
    __bun_throw_not_implemented("uv_poll_init");
    __builtin_unreachable();
}

UV_EXTERN int uv_poll_init_socket(uv_loop_t* loop,
    uv_poll_t* handle,
    uv_os_sock_t socket)
{
    __bun_throw_not_implemented("uv_poll_init_socket");
    __builtin_unreachable();
}

UV_EXTERN int uv_poll_start(uv_poll_t* handle, int events, uv_poll_cb cb)
{
    __bun_throw_not_implemented("uv_poll_start");
    __builtin_unreachable();
}

UV_EXTERN int uv_poll_stop(uv_poll_t* handle)
{
    __bun_throw_not_implemented("uv_poll_stop");
    __builtin_unreachable();
}

UV_EXTERN int uv_prepare_init(uv_loop_t*, uv_prepare_t* prepare)
{
    __bun_throw_not_implemented("uv_prepare_init");
    __builtin_unreachable();
}

UV_EXTERN int uv_prepare_start(uv_prepare_t* prepare, uv_prepare_cb cb)
{
    __bun_throw_not_implemented("uv_prepare_start");
    __builtin_unreachable();
}

UV_EXTERN int uv_prepare_stop(uv_prepare_t* prepare)
{
    __bun_throw_not_implemented("uv_prepare_stop");
    __builtin_unreachable();
}

UV_EXTERN void uv_print_active_handles(uv_loop_t* loop, FILE* stream)
{
    __bun_throw_not_implemented("uv_print_active_handles");
    __builtin_unreachable();
}

UV_EXTERN void uv_print_all_handles(uv_loop_t* loop, FILE* stream)
{
    __bun_throw_not_implemented("uv_print_all_handles");
    __builtin_unreachable();
}

UV_EXTERN uv_pid_t uv_process_get_pid(const uv_process_t*)
{
    __bun_throw_not_implemented("uv_process_get_pid");
    __builtin_unreachable();
}

UV_EXTERN int uv_process_kill(uv_process_t*, int signum)
{
    __bun_throw_not_implemented("uv_process_kill");
    __builtin_unreachable();
}

UV_EXTERN int uv_queue_work(uv_loop_t* loop,
    uv_work_t* req,
    uv_work_cb work_cb,
    uv_after_work_cb after_work_cb)
{
    __bun_throw_not_implemented("uv_queue_work");
    __builtin_unreachable();
}

UV_EXTERN int uv_random(uv_loop_t* loop,
    uv_random_t* req,
    void* buf,
    size_t buflen,
    unsigned flags, /* For future extension must be 0. */
    uv_random_cb cb)
{
    __bun_throw_not_implemented("uv_random");
    __builtin_unreachable();
}

UV_EXTERN int uv_read_start(uv_stream_t*,
    uv_alloc_cb alloc_cb,
    uv_read_cb read_cb)
{
    __bun_throw_not_implemented("uv_read_start");
    __builtin_unreachable();
}

UV_EXTERN int uv_read_stop(uv_stream_t*)
{
    __bun_throw_not_implemented("uv_read_stop");
    __builtin_unreachable();
}

UV_EXTERN int uv_recv_buffer_size(uv_handle_t* handle, int* value)
{
    __bun_throw_not_implemented("uv_recv_buffer_size");
    __builtin_unreachable();
}

UV_EXTERN void uv_ref(uv_handle_t*)
{
    __bun_throw_not_implemented("uv_ref");
    __builtin_unreachable();
}

UV_EXTERN int uv_replace_allocator(uv_malloc_func malloc_func,
    uv_realloc_func realloc_func,
    uv_calloc_func calloc_func,
    uv_free_func free_func)
{
    __bun_throw_not_implemented("uv_replace_allocator");
    __builtin_unreachable();
}

UV_EXTERN void* uv_req_get_data(const uv_req_t* req)
{
    __bun_throw_not_implemented("uv_req_get_data");
    __builtin_unreachable();
}

UV_EXTERN uv_req_type uv_req_get_type(const uv_req_t* req)
{
    __bun_throw_not_implemented("uv_req_get_type");
    __builtin_unreachable();
}

UV_EXTERN void uv_req_set_data(uv_req_t* req, void* data)
{
    __bun_throw_not_implemented("uv_req_set_data");
    __builtin_unreachable();
}

UV_EXTERN size_t uv_req_size(uv_req_type type)
{
    __bun_throw_not_implemented("uv_req_size");
    __builtin_unreachable();
}

UV_EXTERN const char* uv_req_type_name(uv_req_type type)
{
    __bun_throw_not_implemented("uv_req_type_name");
    __builtin_unreachable();
}

UV_EXTERN int uv_resident_set_memory(size_t* rss)
{
    __bun_throw_not_implemented("uv_resident_set_memory");
    __builtin_unreachable();
}

UV_EXTERN int uv_run(uv_loop_t*, uv_run_mode mode)
{
    __bun_throw_not_implemented("uv_run");
    __builtin_unreachable();
}

UV_EXTERN void uv_rwlock_destroy(uv_rwlock_t* rwlock)
{
    __bun_throw_not_implemented("uv_rwlock_destroy");
    __builtin_unreachable();
}

UV_EXTERN int uv_rwlock_init(uv_rwlock_t* rwlock)
{
    __bun_throw_not_implemented("uv_rwlock_init");
    __builtin_unreachable();
}

UV_EXTERN void uv_rwlock_rdlock(uv_rwlock_t* rwlock)
{
    __bun_throw_not_implemented("uv_rwlock_rdlock");
    __builtin_unreachable();
}

UV_EXTERN void uv_rwlock_rdunlock(uv_rwlock_t* rwlock)
{
    __bun_throw_not_implemented("uv_rwlock_rdunlock");
    __builtin_unreachable();
}

UV_EXTERN int uv_rwlock_tryrdlock(uv_rwlock_t* rwlock)
{
    __bun_throw_not_implemented("uv_rwlock_tryrdlock");
    __builtin_unreachable();
}

UV_EXTERN int uv_rwlock_trywrlock(uv_rwlock_t* rwlock)
{
    __bun_throw_not_implemented("uv_rwlock_trywrlock");
    __builtin_unreachable();
}

UV_EXTERN void uv_rwlock_wrlock(uv_rwlock_t* rwlock)
{
    __bun_throw_not_implemented("uv_rwlock_wrlock");
    __builtin_unreachable();
}

UV_EXTERN void uv_rwlock_wrunlock(uv_rwlock_t* rwlock)
{
    __bun_throw_not_implemented("uv_rwlock_wrunlock");
    __builtin_unreachable();
}

UV_EXTERN void uv_sem_destroy(uv_sem_t* sem)
{
    __bun_throw_not_implemented("uv_sem_destroy");
    __builtin_unreachable();
}

UV_EXTERN int uv_sem_init(uv_sem_t* sem, unsigned int value)
{
    __bun_throw_not_implemented("uv_sem_init");
    __builtin_unreachable();
}

UV_EXTERN void uv_sem_post(uv_sem_t* sem)
{
    __bun_throw_not_implemented("uv_sem_post");
    __builtin_unreachable();
}

UV_EXTERN int uv_sem_trywait(uv_sem_t* sem)
{
    __bun_throw_not_implemented("uv_sem_trywait");
    __builtin_unreachable();
}

UV_EXTERN void uv_sem_wait(uv_sem_t* sem)
{
    __bun_throw_not_implemented("uv_sem_wait");
    __builtin_unreachable();
}

UV_EXTERN int uv_send_buffer_size(uv_handle_t* handle, int* value)
{
    __bun_throw_not_implemented("uv_send_buffer_size");
    __builtin_unreachable();
}

UV_EXTERN int uv_set_process_title(const char* title)
{
    __bun_throw_not_implemented("uv_set_process_title");
    __builtin_unreachable();
}

UV_EXTERN char** uv_setup_args(int argc, char** argv)
{
    __bun_throw_not_implemented("uv_setup_args");
    __builtin_unreachable();
}

UV_EXTERN int uv_shutdown(uv_shutdown_t* req,
    uv_stream_t* handle,
    uv_shutdown_cb cb)
{
    __bun_throw_not_implemented("uv_shutdown");
    __builtin_unreachable();
}

UV_EXTERN int uv_signal_init(uv_loop_t* loop, uv_signal_t* handle)
{
    __bun_throw_not_implemented("uv_signal_init");
    __builtin_unreachable();
}

UV_EXTERN int uv_signal_start(uv_signal_t* handle,
    uv_signal_cb signal_cb,
    int signum)
{
    __bun_throw_not_implemented("uv_signal_start");
    __builtin_unreachable();
}

UV_EXTERN int uv_signal_start_oneshot(uv_signal_t* handle,
    uv_signal_cb signal_cb,
    int signum)
{
    __bun_throw_not_implemented("uv_signal_start_oneshot");
    __builtin_unreachable();
}

UV_EXTERN int uv_signal_stop(uv_signal_t* handle)
{
    __bun_throw_not_implemented("uv_signal_stop");
    __builtin_unreachable();
}

UV_EXTERN void uv_sleep(unsigned int msec)
{
    __bun_throw_not_implemented("uv_sleep");
    __builtin_unreachable();
}

UV_EXTERN int uv_socketpair(int type,
    int protocol,
    uv_os_sock_t socket_vector[2],
    int flags0,
    int flags1)
{
    __bun_throw_not_implemented("uv_socketpair");
    __builtin_unreachable();
}

UV_EXTERN int uv_spawn(uv_loop_t* loop,
    uv_process_t* handle,
    const uv_process_options_t* options)
{
    __bun_throw_not_implemented("uv_spawn");
    __builtin_unreachable();
}

UV_EXTERN void uv_stop(uv_loop_t*)
{
    __bun_throw_not_implemented("uv_stop");
    __builtin_unreachable();
}

UV_EXTERN size_t uv_stream_get_write_queue_size(const uv_stream_t* stream)
{
    __bun_throw_not_implemented("uv_stream_get_write_queue_size");
    __builtin_unreachable();
}

UV_EXTERN int uv_stream_set_blocking(uv_stream_t* handle, int blocking)
{
    __bun_throw_not_implemented("uv_stream_set_blocking");
    __builtin_unreachable();
}

UV_EXTERN const char* uv_strerror(int err)
{
    __bun_throw_not_implemented("uv_strerror");
    __builtin_unreachable();
}

UV_EXTERN char* uv_strerror_r(int err, char* buf, size_t buflen)
{
    __bun_throw_not_implemented("uv_strerror_r");
    __builtin_unreachable();
}

UV_EXTERN int uv_tcp_bind(uv_tcp_t* handle,
    const struct sockaddr* addr,
    unsigned int flags)
{
    __bun_throw_not_implemented("uv_tcp_bind");
    __builtin_unreachable();
}

UV_EXTERN int uv_tcp_close_reset(uv_tcp_t* handle, uv_close_cb close_cb)
{
    __bun_throw_not_implemented("uv_tcp_close_reset");
    __builtin_unreachable();
}

UV_EXTERN int uv_tcp_connect(uv_connect_t* req,
    uv_tcp_t* handle,
    const struct sockaddr* addr,
    uv_connect_cb cb)
{
    __bun_throw_not_implemented("uv_tcp_connect");
    __builtin_unreachable();
}

UV_EXTERN int uv_tcp_getpeername(const uv_tcp_t* handle,
    struct sockaddr* name,
    int* namelen)
{
    __bun_throw_not_implemented("uv_tcp_getpeername");
    __builtin_unreachable();
}

UV_EXTERN int uv_tcp_getsockname(const uv_tcp_t* handle,
    struct sockaddr* name,
    int* namelen)
{
    __bun_throw_not_implemented("uv_tcp_getsockname");
    __builtin_unreachable();
}

UV_EXTERN int uv_tcp_init(uv_loop_t*, uv_tcp_t* handle)
{
    __bun_throw_not_implemented("uv_tcp_init");
    __builtin_unreachable();
}

UV_EXTERN int uv_tcp_init_ex(uv_loop_t*, uv_tcp_t* handle, unsigned int flags)
{
    __bun_throw_not_implemented("uv_tcp_init_ex");
    __builtin_unreachable();
}

UV_EXTERN int uv_tcp_keepalive(uv_tcp_t* handle,
    int enable,
    unsigned int delay)
{
    __bun_throw_not_implemented("uv_tcp_keepalive");
    __builtin_unreachable();
}

UV_EXTERN int uv_tcp_nodelay(uv_tcp_t* handle, int enable)
{
    __bun_throw_not_implemented("uv_tcp_nodelay");
    __builtin_unreachable();
}

UV_EXTERN int uv_tcp_open(uv_tcp_t* handle, uv_os_sock_t sock)
{
    __bun_throw_not_implemented("uv_tcp_open");
    __builtin_unreachable();
}

UV_EXTERN int uv_tcp_simultaneous_accepts(uv_tcp_t* handle, int enable)
{
    __bun_throw_not_implemented("uv_tcp_simultaneous_accepts");
    __builtin_unreachable();
}

UV_EXTERN int uv_thread_create(uv_thread_t* tid, uv_thread_cb entry, void* arg)
{
    __bun_throw_not_implemented("uv_thread_create");
    __builtin_unreachable();
}

UV_EXTERN int uv_thread_create_ex(uv_thread_t* tid,
    const uv_thread_options_t* params,
    uv_thread_cb entry,
    void* arg)
{
    __bun_throw_not_implemented("uv_thread_create_ex");
    __builtin_unreachable();
}

UV_EXTERN int uv_thread_detach(uv_thread_t* tid)
{
    __bun_throw_not_implemented("uv_thread_detach");
    __builtin_unreachable();
}

UV_EXTERN int uv_thread_equal(const uv_thread_t* t1, const uv_thread_t* t2)
{
    __bun_throw_not_implemented("uv_thread_equal");
    __builtin_unreachable();
}

UV_EXTERN int uv_thread_getaffinity(uv_thread_t* tid,
    char* cpumask,
    size_t mask_size)
{
    __bun_throw_not_implemented("uv_thread_getaffinity");
    __builtin_unreachable();
}

UV_EXTERN int uv_thread_getcpu(void)
{
    __bun_throw_not_implemented("uv_thread_getcpu");
    __builtin_unreachable();
}

UV_EXTERN int uv_thread_getname(uv_thread_t* tid, char* name, size_t size)
{
    __bun_throw_not_implemented("uv_thread_getname");
    __builtin_unreachable();
}

UV_EXTERN int uv_thread_getpriority(uv_thread_t tid, int* priority)
{
    __bun_throw_not_implemented("uv_thread_getpriority");
    __builtin_unreachable();
}

UV_EXTERN int uv_thread_join(uv_thread_t* tid)
{
    __bun_throw_not_implemented("uv_thread_join");
    __builtin_unreachable();
}

UV_EXTERN uv_thread_t uv_thread_self(void)
{
    __bun_throw_not_implemented("uv_thread_self");
    __builtin_unreachable();
}

UV_EXTERN int uv_thread_setaffinity(uv_thread_t* tid,
    char* cpumask,
    char* oldmask,
    size_t mask_size)
{
    __bun_throw_not_implemented("uv_thread_setaffinity");
    __builtin_unreachable();
}

UV_EXTERN int uv_thread_setname(const char* name)
{
    __bun_throw_not_implemented("uv_thread_setname");
    __builtin_unreachable();
}

UV_EXTERN int uv_thread_setpriority(uv_thread_t tid, int priority)
{
    __bun_throw_not_implemented("uv_thread_setpriority");
    __builtin_unreachable();
}

UV_EXTERN int uv_timer_again(uv_timer_t* handle)
{
    __bun_throw_not_implemented("uv_timer_again");
    __builtin_unreachable();
}

UV_EXTERN uint64_t uv_timer_get_due_in(const uv_timer_t* handle)
{
    __bun_throw_not_implemented("uv_timer_get_due_in");
    __builtin_unreachable();
}

UV_EXTERN uint64_t uv_timer_get_repeat(const uv_timer_t* handle)
{
    __bun_throw_not_implemented("uv_timer_get_repeat");
    __builtin_unreachable();
}

UV_EXTERN int uv_timer_init(uv_loop_t*, uv_timer_t* handle)
{
    __bun_throw_not_implemented("uv_timer_init");
    __builtin_unreachable();
}

UV_EXTERN void uv_timer_set_repeat(uv_timer_t* handle, uint64_t repeat)
{
    __bun_throw_not_implemented("uv_timer_set_repeat");
    __builtin_unreachable();
}

UV_EXTERN int uv_timer_start(uv_timer_t* handle,
    uv_timer_cb cb,
    uint64_t timeout,
    uint64_t repeat)
{
    __bun_throw_not_implemented("uv_timer_start");
    __builtin_unreachable();
}

UV_EXTERN int uv_timer_stop(uv_timer_t* handle)
{
    __bun_throw_not_implemented("uv_timer_stop");
    __builtin_unreachable();
}

UV_EXTERN int uv_translate_sys_error(int sys_errno)
{
    __bun_throw_not_implemented("uv_translate_sys_error");
    __builtin_unreachable();
}

UV_EXTERN int uv_try_write(uv_stream_t* handle,
    const uv_buf_t bufs[],
    unsigned int nbufs)
{
    __bun_throw_not_implemented("uv_try_write");
    __builtin_unreachable();
}

UV_EXTERN int uv_try_write2(uv_stream_t* handle,
    const uv_buf_t bufs[],
    unsigned int nbufs,
    uv_stream_t* send_handle)
{
    __bun_throw_not_implemented("uv_try_write2");
    __builtin_unreachable();
}

UV_EXTERN int uv_tty_get_vterm_state(uv_tty_vtermstate_t* state)
{
    __bun_throw_not_implemented("uv_tty_get_vterm_state");
    __builtin_unreachable();
}

UV_EXTERN int uv_tty_get_winsize(uv_tty_t*, int* width, int* height)
{
    __bun_throw_not_implemented("uv_tty_get_winsize");
    __builtin_unreachable();
}

UV_EXTERN int uv_tty_init(uv_loop_t*, uv_tty_t*, uv_file fd, int readable)
{
    __bun_throw_not_implemented("uv_tty_init");
    __builtin_unreachable();
}

UV_EXTERN int uv_tty_set_mode(uv_tty_t*, uv_tty_mode_t mode)
{
    __bun_throw_not_implemented("uv_tty_set_mode");
    __builtin_unreachable();
}

UV_EXTERN void uv_tty_set_vterm_state(uv_tty_vtermstate_t state)
{
    __bun_throw_not_implemented("uv_tty_set_vterm_state");
    __builtin_unreachable();
}

UV_EXTERN int uv_udp_bind(uv_udp_t* handle,
    const struct sockaddr* addr,
    unsigned int flags)
{
    __bun_throw_not_implemented("uv_udp_bind");
    __builtin_unreachable();
}

UV_EXTERN int uv_udp_connect(uv_udp_t* handle, const struct sockaddr* addr)
{
    __bun_throw_not_implemented("uv_udp_connect");
    __builtin_unreachable();
}

UV_EXTERN size_t uv_udp_get_send_queue_count(const uv_udp_t* handle)
{
    __bun_throw_not_implemented("uv_udp_get_send_queue_count");
    __builtin_unreachable();
}

UV_EXTERN size_t uv_udp_get_send_queue_size(const uv_udp_t* handle)
{
    __bun_throw_not_implemented("uv_udp_get_send_queue_size");
    __builtin_unreachable();
}

UV_EXTERN int uv_udp_getpeername(const uv_udp_t* handle,
    struct sockaddr* name,
    int* namelen)
{
    __bun_throw_not_implemented("uv_udp_getpeername");
    __builtin_unreachable();
}

UV_EXTERN int uv_udp_getsockname(const uv_udp_t* handle,
    struct sockaddr* name,
    int* namelen)
{
    __bun_throw_not_implemented("uv_udp_getsockname");
    __builtin_unreachable();
}

UV_EXTERN int uv_udp_init(uv_loop_t*, uv_udp_t* handle)
{
    __bun_throw_not_implemented("uv_udp_init");
    __builtin_unreachable();
}

UV_EXTERN int uv_udp_init_ex(uv_loop_t*, uv_udp_t* handle, unsigned int flags)
{
    __bun_throw_not_implemented("uv_udp_init_ex");
    __builtin_unreachable();
}

UV_EXTERN int uv_udp_open(uv_udp_t* handle, uv_os_sock_t sock)
{
    __bun_throw_not_implemented("uv_udp_open");
    __builtin_unreachable();
}

UV_EXTERN int uv_udp_recv_start(uv_udp_t* handle,
    uv_alloc_cb alloc_cb,
    uv_udp_recv_cb recv_cb)
{
    __bun_throw_not_implemented("uv_udp_recv_start");
    __builtin_unreachable();
}

UV_EXTERN int uv_udp_recv_stop(uv_udp_t* handle)
{
    __bun_throw_not_implemented("uv_udp_recv_stop");
    __builtin_unreachable();
}

UV_EXTERN int uv_udp_send(uv_udp_send_t* req,
    uv_udp_t* handle,
    const uv_buf_t bufs[],
    unsigned int nbufs,
    const struct sockaddr* addr,
    uv_udp_send_cb send_cb)
{
    __bun_throw_not_implemented("uv_udp_send");
    __builtin_unreachable();
}

UV_EXTERN int uv_udp_set_broadcast(uv_udp_t* handle, int on)
{
    __bun_throw_not_implemented("uv_udp_set_broadcast");
    __builtin_unreachable();
}

UV_EXTERN int uv_udp_set_membership(uv_udp_t* handle,
    const char* multicast_addr,
    const char* interface_addr,
    uv_membership membership)
{
    __bun_throw_not_implemented("uv_udp_set_membership");
    __builtin_unreachable();
}

UV_EXTERN int uv_udp_set_multicast_interface(uv_udp_t* handle,
    const char* interface_addr)
{
    __bun_throw_not_implemented("uv_udp_set_multicast_interface");
    __builtin_unreachable();
}

UV_EXTERN int uv_udp_set_multicast_loop(uv_udp_t* handle, int on)
{
    __bun_throw_not_implemented("uv_udp_set_multicast_loop");
    __builtin_unreachable();
}

UV_EXTERN int uv_udp_set_multicast_ttl(uv_udp_t* handle, int ttl)
{
    __bun_throw_not_implemented("uv_udp_set_multicast_ttl");
    __builtin_unreachable();
}

UV_EXTERN int uv_udp_set_source_membership(uv_udp_t* handle,
    const char* multicast_addr,
    const char* interface_addr,
    const char* source_addr,
    uv_membership membership)
{
    __bun_throw_not_implemented("uv_udp_set_source_membership");
    __builtin_unreachable();
}

UV_EXTERN int uv_udp_set_ttl(uv_udp_t* handle, int ttl)
{
    __bun_throw_not_implemented("uv_udp_set_ttl");
    __builtin_unreachable();
}

UV_EXTERN int uv_udp_try_send(uv_udp_t* handle,
    const uv_buf_t bufs[],
    unsigned int nbufs,
    const struct sockaddr* addr)
{
    __bun_throw_not_implemented("uv_udp_try_send");
    __builtin_unreachable();
}

UV_EXTERN int uv_udp_try_send2(uv_udp_t* handle,
    unsigned int count,
    uv_buf_t* bufs[/*count*/],
    unsigned int nbufs[/*count*/],
    struct sockaddr* addrs[/*count*/],
    unsigned int flags)
{
    __bun_throw_not_implemented("uv_udp_try_send2");
    __builtin_unreachable();
}

UV_EXTERN int uv_udp_using_recvmmsg(const uv_udp_t* handle)
{
    __bun_throw_not_implemented("uv_udp_using_recvmmsg");
    __builtin_unreachable();
}

UV_EXTERN void uv_unref(uv_handle_t*)
{
    __bun_throw_not_implemented("uv_unref");
    __builtin_unreachable();
}

UV_EXTERN void uv_update_time(uv_loop_t*)
{
    __bun_throw_not_implemented("uv_update_time");
    __builtin_unreachable();
}

UV_EXTERN int uv_uptime(double* uptime)
{
    __bun_throw_not_implemented("uv_uptime");
    __builtin_unreachable();
}

UV_EXTERN size_t uv_utf16_length_as_wtf8(const uint16_t* utf16,
    ssize_t utf16_len)
{
    __bun_throw_not_implemented("uv_utf16_length_as_wtf8");
    __builtin_unreachable();
}

UV_EXTERN int uv_utf16_to_wtf8(const uint16_t* utf16,
    ssize_t utf16_len,
    char** wtf8_ptr,
    size_t* wtf8_len_ptr)
{
    __bun_throw_not_implemented("uv_utf16_to_wtf8");
    __builtin_unreachable();
}

UV_EXTERN unsigned int uv_version(void)
{
    __bun_throw_not_implemented("uv_version");
    __builtin_unreachable();
}

UV_EXTERN const char* uv_version_string(void)
{
    __bun_throw_not_implemented("uv_version_string");
    __builtin_unreachable();
}

UV_EXTERN void uv_walk(uv_loop_t* loop, uv_walk_cb walk_cb, void* arg)
{
    __bun_throw_not_implemented("uv_walk");
    __builtin_unreachable();
}

UV_EXTERN int uv_write(uv_write_t* req,
    uv_stream_t* handle,
    const uv_buf_t bufs[],
    unsigned int nbufs,
    uv_write_cb cb)
{
    __bun_throw_not_implemented("uv_write");
    __builtin_unreachable();
}

UV_EXTERN int uv_write2(uv_write_t* req,
    uv_stream_t* handle,
    const uv_buf_t bufs[],
    unsigned int nbufs,
    uv_stream_t* send_handle,
    uv_write_cb cb)
{
    __bun_throw_not_implemented("uv_write2");
    __builtin_unreachable();
}

UV_EXTERN ssize_t uv_wtf8_length_as_utf16(const char* wtf8)
{
    __bun_throw_not_implemented("uv_wtf8_length_as_utf16");
    __builtin_unreachable();
}

UV_EXTERN void uv_wtf8_to_utf16(const char* wtf8,
    uint16_t* utf16,
    size_t utf16_len)
{
    __bun_throw_not_implemented("uv_wtf8_to_utf16");
    __builtin_unreachable();
}
#endif

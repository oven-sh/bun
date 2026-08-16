#ifndef BUN_EMBED_H
#define BUN_EMBED_H

/*
 * Host Bun inside another program.
 *
 * Link against (or dlopen with RTLD_GLOBAL) the `libbun` shared library
 * built with `bun run build --target=libbun`; the RTLD_GLOBAL matters because
 * native addons resolve `napi_*` against the process's global symbol table.
 *
 * Bun keeps a good deal of process-global state, so one process gets one run:
 * bun_embed_run() may be called exactly once, from any thread with a large
 * stack (the standalone executable reserves 18 MB; 8 MB is enough for most
 * scripts). Starting Bun installs its crash-reporting signal handlers, ignores
 * SIGPIPE/SIGXFSZ, puts stdio into unbuffered mode and, on a TTY, restores the
 * terminal state on exit; it reads the process environment (`envp` overrides
 * it before start).
 */

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Run Bun on the calling thread with the given command line, exactly as the
 * `bun` executable would run it (`argv[0]` is the program name, e.g.
 * `{"bun", "run", "script.ts"}`).
 *
 * `envp` (`KEY=VALUE` strings, NULL-terminated) is applied to the process
 * environment before Bun starts; pass NULL to keep it as is.
 *
 * Returns Bun's exit code once the script's event loop drains or the script
 * calls `process.exit()` (or the host calls bun_embed_request_exit()); the
 * runtime is torn down first, so servers and sockets it opened are closed by
 * the time this returns. `on_exit`, if non-NULL, is called with the exit code
 * right before returning; it also fires when Bun ends its run from a place
 * that cannot return to the caller — a subcommand that exits without running
 * a script (`bun --version`), an early command-line error, a crash report —
 * in which case this function never returns and the calling thread parks.
 *
 * Returns -1 (without running anything) when called a second time.
 */
int bun_embed_run(int argc, const char *const *argv, const char *const *envp,
                  void (*on_exit)(int code, void *user), void *user);

/**
 * Ask the running script to exit as if it had called `process.exit(code)`:
 * `process.on('exit')` listeners run, then bun_embed_run() returns `code`.
 * Thread-safe; takes effect the next time the event loop turns (a request
 * that arrives before the event loop starts is applied once it does; one that
 * arrives after the run finished is dropped).
 */
void bun_embed_request_exit(int code);

/** Bun's version string, e.g. "1.3.14". Static; do not free. */
const char *bun_embed_version(void);

#ifdef __cplusplus
}
#endif

#endif /* BUN_EMBED_H */

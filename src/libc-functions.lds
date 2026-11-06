/*
 * Functions of libc that the executable defines itself (src/jsc/bindings/BunSignalActions.cpp). They carry no version, so a
 * library's reference binds to them whichever version of libc's function it names.
 */
{
    global:
	sigaction;
	signal;
	bsd_signal;
	sysv_signal;
	__sysv_signal;
	sigset;
	sigignore;
	pthread_sigmask;
	sigprocmask;
};

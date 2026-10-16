set pagination off
set confirm off
handle SIGUSR1 nostop noprint pass
handle SIGUSR2 nostop noprint pass
handle SIGPWR nostop noprint pass
handle SIGXCPU nostop noprint pass
handle SIGSEGV nostop noprint pass
break Zig::jsFunctionInherits
ignore 1 100000000
run
info breakpoints

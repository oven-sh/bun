import os, resource, subprocess, sys, time
env = {"PATH": os.environ["PATH"], "HOME": os.environ.get("HOME", "/root"), "BUN_DEBUG_QUIET_LOGS": "1", "BUN_DEBUG_NO_DUMP": "1", "BUN_RUNTIME_TRANSPILER_CACHE_PATH": "0", "NO_COLOR": "1"}
args = sys.argv[1:]
while args and "=" in args[0] and not args[0].startswith("/"):
    k, v = args.pop(0).split("=", 1); env[k] = v
t = time.time()
r = subprocess.run(args, env=env)
u = resource.getrusage(resource.RUSAGE_CHILDREN)
print("rc", r.returncode, "wall %.1fs user %.1fs sys %.1fs maxrss %d MB" % (time.time() - t, u.ru_utime, u.ru_stime, u.ru_maxrss // 1024))

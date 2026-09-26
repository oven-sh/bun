// Beyond the six scenarios: the watchdog (jsc --watchdog=300 --watchdog-exception-ok). A timer
// fires while the script is in a loop that never ends, and the VM has to get the main thread out
// of compiled code. Without polling traps that is done from another thread, with signals.
print("watchdog loop started");
var x = 0;
while (true)
    x = (x + 1) | 0;
print("not reached");

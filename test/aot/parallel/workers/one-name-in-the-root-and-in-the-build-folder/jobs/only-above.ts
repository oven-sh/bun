// app/main.ts starts this file as a Worker. Run as a program it has no parent.
if (Bun.isMainThread) console.log("no parent");
else postMessage("jobs/only-above.ts");

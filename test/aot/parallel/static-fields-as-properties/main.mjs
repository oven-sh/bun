// A static field that became a property of its class object is read and stored by a loop. The file is imported at run time, and its imports form a cycle.
await import("./loop.ts");

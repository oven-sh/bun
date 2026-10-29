// The first entry point of an executable that holds many programs as further entry points: it imports the one that AOT_PROGRAM names. ../programs-as-entry-points.ts builds and starts it.
await import(process.env.AOT_PROGRAM!);
export {};

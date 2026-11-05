console.log("suspended starts");
await new Promise(resolve => {
  globalThis.resumeSuspendedModule = resolve;
});
console.log("suspended resumes");
export const value = "finished";

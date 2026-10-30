const begin = async () => {
  console.log("await-in-a-branch begins");
};
if (globalThis.process) await begin();
console.log("await-in-a-branch ran");
export const name = "await-in-a-branch";

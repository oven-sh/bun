console.log("the file runs behind", globalThis.jobs, "jobs");
let row = Promise.resolve();
for (let i = 0; i < 40; i++) row = row.then(() => void globalThis.jobsBehindTheFile++);
throw new Error("thrown by the file");

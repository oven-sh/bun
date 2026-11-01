console.log("fulfills-later starts");
await new Promise(resolve => setTimeout(resolve));
console.log("fulfills-later resumes");
export const done = true;

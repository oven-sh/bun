// The name of a file that is a member of an enum, or is computed with one, is as good as written: the file is in the executable.
console.log("import-of-a-member:", (await import("./import-of-a-member.ts")).found);
console.log("import-of-a-sum:", (await import("./import-of-a-sum.ts")).found);
console.log("import-of-a-template:", (await import("./import-of-a-template.ts")).found);
console.log("require-of-a-member:", (await import("./require-of-a-member.ts")).found);
console.log("require-of-a-sum:", (await import("./require-of-a-sum.ts")).found);
console.log("require-of-a-template:", (await import("./require-of-a-template.ts")).found);
console.log("require-of-a-constant-that-holds-a-member:", (await import("./require-of-a-constant-that-holds-a-member.ts")).found);
console.log("require-of-a-constant-that-holds-a-sum:", (await import("./require-of-a-constant-that-holds-a-sum.ts")).found);
console.log("require-of-what-a-conditional-chooses:", (await import("./require-of-what-a-conditional-chooses.ts")).found);
console.log("require-of-what-comes-out-of-a-list:", (await import("./require-of-what-comes-out-of-a-list.ts")).found);
console.log("require-of-what-stands-behind-a-comma:", (await import("./require-of-what-stands-behind-a-comma.ts")).found);
console.log("resolve-of-a-member:", (await import("./resolve-of-a-member.ts")).found);
console.log("import-meta-resolve-of-a-member:", (await import("./import-meta-resolve-of-a-member.ts")).found);

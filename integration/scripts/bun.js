const fail = true;
// import snippets from "./snippets.json";

// globalThis.console.assert = (condition, ...content) => {
//   if (!condition) {
//     throw new Error(content.join(" "));
//   }
// };
// globalThis.getModuleScriptSrc = async (name) => {
//   const response = await fetch(name, {
//     cache: "force-cache",
//   });

//   if (response.ok) {
//     return await response.text();
//   } else {
//     throw new Error(`Failed to get module script ${name}`);
//   }
// };

// globalThis.runTest = async (name) => {
//   testSuccess = false;
//   var Namespace = await import(name);
//   var testFunction = Namespace.test;

//   if (
//     !("test" in Namespace) &&
//     "default" in Namespace &&
//     typeof Namespace.default === "function"
//   ) {
//     Namespace = Namespace.default();
//     testFunction = Namespace.test;
//   }

//   if (!testFunction) {
//     throw new Error("No test function found in " + name);
//   }

//   if (typeof testFunction !== "function") {
//     throw new Error(
//       `Expected (await import(\"${name}\"")) to have a test function.\nReceived: ${Object.keys(
//         Namespace
//       ).join(", ")} `
//     );
//   }

//   if (globalThis.BUN_DEBUG_MODE) {
//     try {
//       await testFunction();
//       if (!testSuccess) {
//         throw new Error("Test failed");
//       }
//     } catch (exception) {
//       console.error(exception);
//       debugger;
//       throw exception;
//     }
//   } else {
//     await testFunction();
//     if (!testSuccess) {
//       throw new Error("Test failed");
//     }
//   }
// };

// var testSuccess = false;
// globalThis.testDone = () => {
//   testSuccess = true;
// };

// let fail = 0;
// for (let snippet of snippets) {
//   try {
//     await runTest("../snippets/" + snippet.substring(1));
//     console.log("✅", snippet);
//   } catch (exception) {
//     console.error(`❌ ${snippet}`);
//     console.error(exception);

//     fail++;
//   }
// }

if (fail) throw new Error(`❌ browser test failed (${fail})`);

console.log(`✅ bun.js test passed`);

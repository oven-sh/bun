// A file that is required deletes the `exports` of its parent, whose body is under way. Where the parent stores `module.exports` behind that, the store makes the property anew and is what require() answers.
// Where it has stored in front of it, the delete is the later of the two and require() answers nothing.
console.log(JSON.stringify(require("./stores-behind.cjs")), JSON.stringify(require("./stores-behind.cjs")));
console.log(JSON.stringify(require("./stores-in-front.cjs")), JSON.stringify(require("./stores-in-front.cjs")));
console.log(JSON.stringify(require("./stores-never.cjs")), JSON.stringify(require("./stores-never.cjs")));

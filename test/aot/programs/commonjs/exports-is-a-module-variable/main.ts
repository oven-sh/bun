// `exports` is an ordinary variable of a CommonJS module and can be reassigned.
import main from "./cjs/reassign.js"
console.log(main(), (main as any).helper())

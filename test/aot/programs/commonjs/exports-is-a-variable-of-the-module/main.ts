// `exports` is a variable of the module.
import main from "./cjs/reassign.js"
console.log(main(), (main as any).helper())

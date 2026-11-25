// Text that the build cannot read lays a function over Module._resolveFilename and is handed the module object of the compiled file that asks. Nobody in sight holds that file's exports as a value, so there is no such object.
// The module object shows none then, as the parent that such a hook is handed in an executable built without --aot. An empty object in its place would answer in silence whoever lists it.
// Reference: bun build --compile
import "./start.cjs";

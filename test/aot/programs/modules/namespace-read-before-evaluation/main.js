// An `import * as` namespace object that a hoisted function of an import cycle returns before the module has run: a read throws a ReferenceError and does not evaluate the module, and the object is not a deferred namespace.
import "./holder.mjs";

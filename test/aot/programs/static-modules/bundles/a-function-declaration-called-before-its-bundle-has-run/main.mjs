// A bundle that imports nothing and lies on no cycle. Its importer lies on one, so a function declaration of the bundle is called before the bundle has run: the wrappers are still empty variables.
import "./importer.mjs";

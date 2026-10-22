// No import leads from d.mjs back to a.mjs: it asks for it by a name that it puts together, while a.mjs waits for its imports.
import "./a.mjs";

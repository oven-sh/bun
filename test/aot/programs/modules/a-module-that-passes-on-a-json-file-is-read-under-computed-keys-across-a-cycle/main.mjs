// passes-on.mjs exports data.json again, whole and name by name. caller.mjs runs ahead of both and has reader.mjs read the namespace object of passes-on.mjs under computed keys.
import "./reader.mjs";

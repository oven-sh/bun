// caller.mjs runs ahead of reader.mjs, which imports it, and reads what reader.mjs imports from data files of every kind. All are there but the text and the Markdown, which are in their dead zones.
import "./reader.mjs";

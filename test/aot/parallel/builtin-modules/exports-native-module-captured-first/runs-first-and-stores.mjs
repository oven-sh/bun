// On Windows the title is the console's: a process starts with what the last one there has left. Only a text made out of it is known to differ from it.
export const titleAtTheStart = process.title;
process.argv = ["stored by the first module"];
process.title = titleAtTheStart + ", stored by the first module";

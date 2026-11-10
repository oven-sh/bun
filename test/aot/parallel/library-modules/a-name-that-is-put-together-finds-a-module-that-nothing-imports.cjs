// Nothing in this program imports node:path by name, and nothing in it spells that name. The executable holds the module all the same, and a name that is put together while the program runs finds it.
console.log(typeof require(JSON.parse(process.env.NOBODY_SETS_THIS_ONE ?? '"node:pa"') + "th").join);

// Nobody listens: the printer of the library writes the warning to standard error. What is printed here shows that the program goes on.
setTimeout(() => console.log("rang"), -1);
setTimeout(() => console.log("rang again"), 5);

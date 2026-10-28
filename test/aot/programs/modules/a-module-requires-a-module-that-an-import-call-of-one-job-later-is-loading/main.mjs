// import() loads a module that requires a second one. One job after that call, another import() begins to load the second one, so require() comes to a module whose load is under way, and returns it. Plain Bun prints another output.
import("./requires.mjs");
Promise.resolve().then(() => import("./required.mjs"));

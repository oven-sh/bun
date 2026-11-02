// The file that a bundler made need not ask for what its helper wraps in its own body: a call that is reached from anywhere makes the request.
// Each of these files imports nothing itself. What it queues runs behind the body of main.mjs all the same.
import { lazy as calledLater } from "./in-an-exported-function-that-main-calls.mjs";
import { box } from "./in-an-exported-getter-that-main-reads-later.mjs";
import { named } from "./in-an-exported-function-that-main-only-names.mjs";
import { kept } from "./in-a-function-kept-on-the-global-object.mjs";
import { branch } from "./in-a-function-called-in-a-branch-never-taken.mjs";
import { timed } from "./in-the-arrow-of-a-timer.mjs";
import { outer } from "./in-a-second-inner-module.mjs";
console.log("body: main", calledLater(), typeof named, kept, branch, timed, outer);
setTimeout(() => console.log("later: the getter", box.x), 0);

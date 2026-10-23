// The identity of a member of a cycle of types does not depend on which member a file asks about first, nor on what the checker has answered in an earlier file. One checker visits the two short files one after the other, because the long file makes them a small part of the program.
import "./cycle-in-two-files-of-one-task-long";
import "./cycle-in-two-files-of-one-task-other";
import type { First, Second } from "./cycle-in-two-files-of-one-task-other";
let second: Second;
let first: First;
export {};

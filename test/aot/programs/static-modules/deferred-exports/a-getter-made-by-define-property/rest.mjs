import { AssertionError, CallTracker } from "node:assert";
export const held = () => AssertionError;
export const tracker = () => CallTracker;

import { promises } from "node:fs";
export const read = () => promises.readFile("/no/such/file");

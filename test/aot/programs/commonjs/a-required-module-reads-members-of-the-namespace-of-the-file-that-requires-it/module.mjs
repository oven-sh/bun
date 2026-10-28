import * as file from "./file.cjs";
export const seen = [typeof file.early, typeof file.late].join();
console.log("the module reads", file.early, file.late);

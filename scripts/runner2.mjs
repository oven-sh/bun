import { getCommit, getDiff, getRepository } from "../utils/git.mjs";

const repository = getRepository();
console.log(repository);

const commit = getCommit();
console.log(commit);

const diff = await getDiff();
console.log(diff);

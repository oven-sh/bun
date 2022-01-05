import { fetchSync } from "macro:./fetchSync.tsx";

const synchronousFetch = fetchSync(`https://example.com`);

console.log(synchronousFetch);

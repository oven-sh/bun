export const start = () => new Worker(new URL("../../../jobs/job.js", import.meta.url));

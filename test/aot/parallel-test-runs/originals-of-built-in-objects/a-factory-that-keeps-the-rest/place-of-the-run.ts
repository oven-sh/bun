import { cwd, uptime } from 'node:process';

export const placeOfTheRun = () => `${cwd()} ${typeof uptime}`;

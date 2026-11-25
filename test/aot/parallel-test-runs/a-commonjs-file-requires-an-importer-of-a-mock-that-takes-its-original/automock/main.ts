import { widget } from './widget';
import { mode } from './env';
import * as legacy from './legacy.cjs';
export const run = () => [legacy.store(), mode, widget()].join();

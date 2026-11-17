import * as legacy from './legacy.cjs';
import { widget } from './widget';
import { mode } from './env';
export const run = () => [legacy.store(), mode, widget()].join();

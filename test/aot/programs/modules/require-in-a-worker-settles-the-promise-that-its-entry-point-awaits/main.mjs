import { Worker } from 'node:worker_threads'; const w = new Worker(new URL('./worker.mjs', import.meta.url)); w.on('exit', c => console.log('worker exits', c));

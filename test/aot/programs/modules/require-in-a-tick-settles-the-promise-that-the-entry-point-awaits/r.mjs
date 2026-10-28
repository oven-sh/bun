export const a = await Promise.resolve(1); globalThis.settle(1); console.log('r settled the gate'); await Promise.resolve(2); console.log('r ends');

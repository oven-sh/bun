(globalThis as any).settle(1); console.log('r settled the gate'); export const a: number = await Promise.resolve(1); console.log('r ends');

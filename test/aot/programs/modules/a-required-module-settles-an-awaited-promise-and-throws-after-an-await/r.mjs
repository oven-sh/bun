globalThis.settle(1); console.log('r settled the gate'); await Promise.resolve(); throw new Error('from r');

for (const bad of [undefined, null, 1, 'Boolean', {}]) { try { [1].filter(bad); console.log('no throw'); } catch (error) { console.log(error instanceof TypeError); } }

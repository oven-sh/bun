const grid = Array.from({ length: 2 }, () => Array.from({ length: 2 }, undefined)); console.log(JSON.stringify(grid), grid[1].map(v => typeof v).join(), 0 in grid[0]);

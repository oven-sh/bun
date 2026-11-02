// Read while the file loads: the files of a bundle share one variable of each name, so `bun build --compile` answers a later read with the path of the file that loaded last.
export const where: string[] = [__dirname, __filename];

import v8 from 'v8';
import vm from 'vm';

class Random extends null {
    static seed: number = NaN; //! There doesn't seem to be a way to get the initial seed from v8.
    static context: vm.Context = vm.createContext({}, { name: 'NodeBun_MathRandom_Context_0' });
    static readonly script: vm.Script = new vm.Script('Math.random();', { filename: 'NodeBun_MathRandom' });

    static setSeed(seed: number) {
        Random.seed = parseInt(seed as unknown as string) || 0;
        Random.context = vm.createContext({ v8 }, { name: `NodeBun_MathRandom_Context_${Random.seed}` });
        vm.runInContext(`v8.setFlagsFromString('--random_seed=${Random.seed}');`, Random.context, { filename: `NodeBun_MathRandom_SetSeed_${Random.seed}` });
    }
    static gen(): number {
        return Random.script.runInContext(Random.context, { filename: `NodeBun_MathRandom_Gen_${Random.seed}` }) as number;
    }
    // lazily only apply the global patch if get/setRandomSeed is called
    static PATCH_CHECK = () => {
        Math.random = Random.gen;
        Random.PATCH_CHECK = () => {};
    }
}
export function setRandomSeed(seed: number): void {
    Random.PATCH_CHECK();
    return Random.setSeed(seed);
}
export function getRandomSeed(): number {
    Random.PATCH_CHECK();
    return Random.seed;
}

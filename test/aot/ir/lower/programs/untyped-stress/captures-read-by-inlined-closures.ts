// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 1

// FILE: main.ts
// Inlined closures read captured variables, also after loops whose iterations have their own scopes.
import "./impl.js";

// FILE: impl.js
function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

(function () {
    let later = [];
    const results = () => { let all = later.map(f => f()).join(); later = []; return all; };

    const probe = a => {
        const probeInner = b => a + b;
        return probeInner(1);
    };
    check(probe(1), 2, "the probe");

    const afterLoop = a => {
        const afterLoopInner = b => {
            for (let i = 0; i < 3; i++)
                later.push(() => b + i);
            return a;
        };
        return afterLoopInner(3);
    };
    check(afterLoop("A"), "A", "read after a loop with scopes of its own");
    check(results(), "3,4,5", "the closures of the loop");
    check(afterLoop(1.5), 1.5, "another type");
    results();

    const capturedInLoop = a => {
        const capturedInLoopInner = b => {
            for (let i = 0; i < 3; i++)
                later.push(() => a + b + i);
        };
        capturedInLoopInner(3);
    };
    capturedInLoop("A");
    check(results(), "A30,A31,A32", "captured again by the closures of the loop");

    const twoLevels = a => {
        const twoLevelsMiddle = m => {
            const twoLevelsInner = b => {
                for (let i = 0; i < 2; i++)
                    later.push(() => b + i);
                return a + m;
            };
            return twoLevelsInner(3);
        };
        return twoLevelsMiddle("M");
    };
    check(twoLevels("A"), "AM", "variables of the maker and of the maker's maker");
    check(results(), "3,4", "the closures of the loop");

    const blockInWhile = a => {
        const blockInWhileInner = b => {
            let n = 0;
            while (n < 2) {
                const k = n * 10;
                later.push(() => b + k);
                n++;
            }
            return a;
        };
        return blockInWhileInner(3);
    };
    check(blockInWhile("A"), "A", "read after a while loop with a block scope");
    check(results(), "3,13", "the closures of the loop");

    function ordinaryFunctions(a) {
        const ordinaryFunctionsInner = function (b) {
            for (let i = 0; i < 3; i++)
                later.push(() => b + i);
            return a;
        };
        return ordinaryFunctionsInner(3);
    }
    check(ordinaryFunctions("A"), "A", "function expressions");
    check(results(), "3,4,5", "the closures of the loop");

    const insideLoop = a => {
        const insideLoopInner = b => {
            let s = "";
            for (let i = 0; i < 3; i++) {
                later.push(() => b + i);
                s += a;
            }
            return s;
        };
        return insideLoopInner(3);
    };
    check(insideLoop("A"), "AAA", "read inside the loop");
    results();

    const alsoReturned = a => {
        const alsoReturnedInner = b => {
            for (let i = 0; i < 2; i++)
                later.push(() => b + i);
            return a;
        };
        return [alsoReturnedInner(3), alsoReturnedInner];
    };
    {
        let [first, inner] = alsoReturned("A");
        check(first, "A", "inlined");
        check(inner(7), "A", "the same closure called from outside holds the value");
        check(results(), "3,4,7,8", "the closures of both calls");
    }

    const makerInLoop = n => {
        let all = "";
        for (let j = 0; j < n; j++) {
            const a = "a" + j;
            const makerInLoopInner = b => {
                for (let i = 0; i < 2; i++)
                    later.push(() => b + i);
                return a;
            };
            all += makerInLoopInner(j);
        }
        return all;
    };
    check(makerInLoop(3), "a0a1a2", "the maker's scope is made once for each iteration");
    check(results(), "0,1,1,2,2,3", "the closures of the loops");

    const uninitialized = () => {
        const uninitializedInner = b => {
            for (let i = 0; i < 2; i++)
                later.push(() => b + i);
            return late;
        };
        try {
            return uninitializedInner(3);
        } catch (error) {
            return error.constructor.name;
        }
        let late = 1;
    };
    check(uninitialized(), "ReferenceError", "a variable that is never initialized");
    results();

    const afterBlock = a => {
        {
            const t = 1;
            later.push(() => t);
        }
        const afterBlockInner = b => {
            for (let i = 0; i < 2; i++)
                later.push(() => b + i);
            return a;
        };
        return afterBlockInner(3);
    };
    check(afterBlock("A"), "A", "made after a block scope of the maker was left");
    check(results(), "1,3,4", "the closures");

    const afterLoopOfMaker = a => {
        for (let j = 0; j < 2; j++)
            later.push(() => j);
        const afterLoopOfMakerInner = b => a + b;
        return afterLoopOfMakerInner(3);
    };
    check(afterLoopOfMaker("A"), "A3", "made after a loop of the maker with scopes of its own");
    check(results(), "0,1", "the closures");

    const afterBothLoops = a => {
        for (let j = 0; j < 2; j++)
            later.push(() => j);
        const afterBothLoopsInner = b => {
            for (let i = 0; i < 2; i++)
                later.push(() => b + i);
            return a;
        };
        return afterBothLoopsInner(3);
    };
    check(afterBothLoops("A"), "A", "a loop in the maker and a loop in the closure");
    check(results(), "0,1,3,4", "the closures");

    const inBlockOfMaker = a => {
        {
            const t = a + "t";
            const inBlockOfMakerInner = b => {
                for (let i = 0; i < 2; i++)
                    later.push(() => b + i);
                return a + t;
            };
            return inBlockOfMakerInner(3);
        }
    };
    check(inBlockOfMaker("A"), "AAt", "a variable of a block and a variable of the function");
    check(results(), "3,4", "the closures");

    function readsInLoop(list) {
        const kept = list;
        const readsInLoopInner = a => {
            kept.push(() => a);
            for (let j = 0; j < 2; j++)
                kept.push(() => j);
            return kept.length;
        };
        return readsInLoopInner("A");
    }
    check(readsInLoop(later), 3, "read in and after the loop");
    check(results(), "A,0,1", "the closures");

    function returnsClosureMadeAfterLoop(list) {
        const kept = list;
        const returnsClosureMadeAfterLoopInner = a => {
            for (let j = 0; j < 2; j++)
                kept.push(() => j);
            return b => a + b + kept.length;
        };
        return returnsClosureMadeAfterLoopInner("A");
    }
    check(returnsClosureMadeAfterLoop(later)(3), "A32", "captured again by a closure that is made after the loop");
    check(results(), "0,1", "the closures");

    const inBranches = (a, c) => {
        const inBranchesInner = b => {
            if (c) {
                const k = 1;
                later.push(() => b + k);
            } else {
                const j = 2;
                later.push(() => b + j);
            }
            return a;
        };
        return inBranchesInner(3);
    };
    check(inBranches("A", true) + inBranches("B", false), "AB", "scopes in branches");
    check(results(), "4,5", "the closures of the branches");
})();
console.log("passed");

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }

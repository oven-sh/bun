// Fixed seeds of fuzz/things-put-somewhere-taken-out-again-and-used-where-others-arrive-too.ts: one thing is put somewhere (the prototype of a function, the cause of an error, a promise, a map, a descriptor, a proxy,
// the reason of a signal, the data of a socket ..), taken out again, in the same file or in another one, and used at a place where another thing of its kind arrives too. Every place meets every thing that it
// takes, and every place stands twice ahead of another place that the thing goes through too.
// TypeScript accepts every program, so every build succeeds, and the executable prints what plain Bun prints and ends as it ends. Every third program is built with its types erased.
import { Random } from "../random";
import { corners, drawn, generate } from "../things-put-somewhere-taken-out-again-and-used-where-others-arrive-too";
import { family } from "../family";

/** The thing loads modules, makes functions out of text or evaluates text, and the executable refuses the call behind the place. */
const losesWhatLoads = [
  1494, 1544, 1546, 1549, 1562, 1575, 1581, 1626, 1628, 1637, 1639, 1647, 1659, 1692, 1693, 1694, 1707, 1716, 1720,
  1721, 1722, 1725, 1726, 1728, 1740, 1773, 1782, 1784, 1792, 1834, 1837, 1839, 1861, 1865, 1866, 1867, 1871, 1873,
  1916, 1918, 1923, 1925, 1927, 1929, 1937, 1982, 1983, 1984, 1988, 1995, 1997, 2006, 2010, 2011, 2012, 2014, 2015,
  2016, 2036, 2072, 2074, 2082, 2124, 2128, 2129, 2151, 2155, 2156, 2157, 2161, 2163, 2345, 2353, 2360, 2362, 2364,
  2372, 2414, 2417, 2418, 2419, 2445, 2447, 2450, 2451, 2453, 2498, 2502, 2507, 2509, 2517, 2559, 2562, 2563, 2564,
  2577, 2586, 2590, 2591, 2592, 2594, 2596, 3346, 3355, 3362, 3363, 3366, 3368, 3370, 3375, 3376, 3378, 3379, 3382,
  3384, 3386, 3387, 3388, 3389, 3390, 3391, 3402, 3406, 3407, 3408, 3409, 3410, 3411, 3412, 3413, 3416, 3417, 3418,
  3420, 3422, 3423, 3426, 3428, 3431, 3433, 3435, 3450, 3451, 3452, 3454, 3460, 3461, 3462, 3464, 3466, 3467, 3470,
  3472, 3475, 3479, 3487, 3494, 3495, 3496, 3497, 3498, 3499, 3500, 3501, 3504, 3505, 3506, 3508, 3509, 3510, 3511,
  3514, 3516, 3517, 3520, 3521, 3523, 3530, 3538, 3539, 3540, 3541, 3542, 3543, 3548, 3549, 3550, 3551, 3552, 3554,
  3555, 3558, 3560, 3609, 3611, 3626, 3627, 3628, 3630, 3631, 3632, 3636, 3637, 3638, 3640, 3641, 3642, 3643, 3648,
  3651, 3653, 3655, 3662, 3670, 3671, 3672, 3674, 3675, 3680, 3681, 3682, 3684, 3686, 3687, 3690, 3692, 3813, 3818,
  3832, 3835, 3853, 3872, 3875, 3877, 3892, 3917, 3932, 3947, 3950, 3951, 3953, 3954, 3957, 3958, 3978, 3999, 4002,
  4021, 4035, 4057, 4058, 4059, 4078, 4082, 4095, 4096, 4118, 4121, 4136, 4138, 4139, 4142, 4156, 4157, 4158,
];

export default family(
  "things put somewhere, taken out again and used where others arrive too",
  drawn.map(({ corner, thing, then }, index) => {
    const row = Math.floor(index / corners.length);
    const isErased = (index + row) % 3 === 2;
    return {
      name: `seed ${index + 1}, ${corner}, ${then ? `then ${then}, ` : ""}${thing}${isErased ? ", types erased" : ""}.`,
      ...(isErased && { flags: ["--aot-erase-types"] }),
      // No executable lists its own modules there, with or without --aot.
      ...(corner === "the cache of require" && { referenceIsCompiled: true as const }),
      ...(losesWhatLoads.includes(index + 1) && {
        linesDepartToday: "what loads modules or runs text is refused once it has been there",
      }),
      make: () => generate(new Random(index + 1), corner, thing, then),
    };
  }),
);

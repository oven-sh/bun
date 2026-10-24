// Unbounded recursion through each form of the stack check throws a RangeError that can be caught, and bounded recursion does not.
declare const console: any;
function small(n: number): number {
    return small(n + 1) + 1;
}
function value(n: number): number {
    return n & 1;
}
function largeFrame(n: number): number {
    const values = [
        value(n + 0), value(n + 1), value(n + 2), value(n + 3), value(n + 4), value(n + 5), value(n + 6), value(n + 7), value(n + 8), value(n + 9),
        value(n + 10), value(n + 11), value(n + 12), value(n + 13), value(n + 14), value(n + 15), value(n + 16), value(n + 17), value(n + 18), value(n + 19),
        value(n + 20), value(n + 21), value(n + 22), value(n + 23), value(n + 24), value(n + 25), value(n + 26), value(n + 27), value(n + 28), value(n + 29),
        value(n + 30), value(n + 31), value(n + 32), value(n + 33), value(n + 34), value(n + 35), value(n + 36), value(n + 37), value(n + 38), value(n + 39),
        value(n + 40), value(n + 41), value(n + 42), value(n + 43), value(n + 44), value(n + 45), value(n + 46), value(n + 47), value(n + 48), value(n + 49),
        value(n + 50), value(n + 51), value(n + 52), value(n + 53), value(n + 54), value(n + 55), value(n + 56), value(n + 57), value(n + 58), value(n + 59),
        value(n + 60), value(n + 61), value(n + 62), value(n + 63), value(n + 64), value(n + 65), value(n + 66), value(n + 67), value(n + 68), value(n + 69),
        value(n + 70), value(n + 71), value(n + 72), value(n + 73), value(n + 74), value(n + 75), value(n + 76), value(n + 77), value(n + 78), value(n + 79),
        value(n + 80), value(n + 81), value(n + 82), value(n + 83), value(n + 84), value(n + 85), value(n + 86), value(n + 87), value(n + 88), value(n + 89),
        value(n + 90), value(n + 91), value(n + 92), value(n + 93), value(n + 94), value(n + 95), value(n + 96), value(n + 97), value(n + 98), value(n + 99),
        value(n + 100), value(n + 101), value(n + 102), value(n + 103), value(n + 104), value(n + 105), value(n + 106), value(n + 107), value(n + 108), value(n + 109),
        value(n + 110), value(n + 111), value(n + 112), value(n + 113), value(n + 114), value(n + 115), value(n + 116), value(n + 117), value(n + 118), value(n + 119),
        value(n + 120), value(n + 121), value(n + 122), value(n + 123), value(n + 124), value(n + 125), value(n + 126), value(n + 127), value(n + 128), value(n + 129),
        value(n + 130), value(n + 131), value(n + 132), value(n + 133), value(n + 134), value(n + 135), value(n + 136), value(n + 137), value(n + 138), value(n + 139),
        value(n + 140), value(n + 141), value(n + 142), value(n + 143), value(n + 144), value(n + 145), value(n + 146), value(n + 147), value(n + 148), value(n + 149),
        value(n + 150), value(n + 151), value(n + 152), value(n + 153), value(n + 154), value(n + 155), value(n + 156), value(n + 157), value(n + 158), value(n + 159),
        value(n + 160), value(n + 161), value(n + 162), value(n + 163), value(n + 164), value(n + 165), value(n + 166), value(n + 167), value(n + 168), value(n + 169),
        value(n + 170), value(n + 171), value(n + 172), value(n + 173), value(n + 174), value(n + 175), value(n + 176), value(n + 177), value(n + 178), value(n + 179),
        value(n + 180), value(n + 181), value(n + 182), value(n + 183), value(n + 184), value(n + 185), value(n + 186), value(n + 187), value(n + 188), value(n + 189),
        value(n + 190), value(n + 191), value(n + 192), value(n + 193), value(n + 194), value(n + 195), value(n + 196), value(n + 197), value(n + 198), value(n + 199),
        value(n + 200), value(n + 201), value(n + 202), value(n + 203), value(n + 204), value(n + 205), value(n + 206), value(n + 207), value(n + 208), value(n + 209),
        value(n + 210), value(n + 211), value(n + 212), value(n + 213), value(n + 214), value(n + 215), value(n + 216), value(n + 217), value(n + 218), value(n + 219),
        value(n + 220), value(n + 221), value(n + 222), value(n + 223), value(n + 224), value(n + 225), value(n + 226), value(n + 227), value(n + 228), value(n + 229),
        value(n + 230), value(n + 231), value(n + 232), value(n + 233), value(n + 234), value(n + 235), value(n + 236), value(n + 237), value(n + 238), value(n + 239),
        value(n + 240), value(n + 241), value(n + 242), value(n + 243), value(n + 244), value(n + 245), value(n + 246), value(n + 247), value(n + 248), value(n + 249),
        value(n + 250), value(n + 251), value(n + 252), value(n + 253), value(n + 254), value(n + 255), value(n + 256), value(n + 257), value(n + 258), value(n + 259),
        value(n + 260), value(n + 261), value(n + 262), value(n + 263), value(n + 264), value(n + 265), value(n + 266), value(n + 267), value(n + 268), value(n + 269),
        value(n + 270), value(n + 271), value(n + 272), value(n + 273), value(n + 274), value(n + 275), value(n + 276), value(n + 277), value(n + 278), value(n + 279),
        value(n + 280), value(n + 281), value(n + 282), value(n + 283), value(n + 284), value(n + 285), value(n + 286), value(n + 287), value(n + 288), value(n + 289),
        value(n + 290), value(n + 291), value(n + 292), value(n + 293), value(n + 294), value(n + 295), value(n + 296), value(n + 297), value(n + 298), value(n + 299),
        value(n + 300), value(n + 301), value(n + 302), value(n + 303), value(n + 304), value(n + 305), value(n + 306), value(n + 307), value(n + 308), value(n + 309),
        value(n + 310), value(n + 311), value(n + 312), value(n + 313), value(n + 314), value(n + 315), value(n + 316), value(n + 317), value(n + 318), value(n + 319),
        value(n + 320), value(n + 321), value(n + 322), value(n + 323), value(n + 324), value(n + 325), value(n + 326), value(n + 327), value(n + 328), value(n + 329),
        value(n + 330), value(n + 331), value(n + 332), value(n + 333), value(n + 334), value(n + 335), value(n + 336), value(n + 337), value(n + 338), value(n + 339),
        value(n + 340), value(n + 341), value(n + 342), value(n + 343), value(n + 344), value(n + 345), value(n + 346), value(n + 347), value(n + 348), value(n + 349),
        value(n + 350), value(n + 351), value(n + 352), value(n + 353), value(n + 354), value(n + 355), value(n + 356), value(n + 357), value(n + 358), value(n + 359),
        value(n + 360), value(n + 361), value(n + 362), value(n + 363), value(n + 364), value(n + 365), value(n + 366), value(n + 367), value(n + 368), value(n + 369),
        value(n + 370), value(n + 371), value(n + 372), value(n + 373), value(n + 374), value(n + 375), value(n + 376), value(n + 377), value(n + 378), value(n + 379),
        value(n + 380), value(n + 381), value(n + 382), value(n + 383), value(n + 384), value(n + 385), value(n + 386), value(n + 387), value(n + 388), value(n + 389),
        value(n + 390), value(n + 391), value(n + 392), value(n + 393), value(n + 394), value(n + 395), value(n + 396), value(n + 397), value(n + 398), value(n + 399),
        value(n + 400), value(n + 401), value(n + 402), value(n + 403), value(n + 404), value(n + 405), value(n + 406), value(n + 407), value(n + 408), value(n + 409),
        value(n + 410), value(n + 411), value(n + 412), value(n + 413), value(n + 414), value(n + 415), value(n + 416), value(n + 417), value(n + 418), value(n + 419),
        value(n + 420), value(n + 421), value(n + 422), value(n + 423), value(n + 424), value(n + 425), value(n + 426), value(n + 427), value(n + 428), value(n + 429),
        value(n + 430), value(n + 431), value(n + 432), value(n + 433), value(n + 434), value(n + 435), value(n + 436), value(n + 437), value(n + 438), value(n + 439),
        value(n + 440), value(n + 441), value(n + 442), value(n + 443), value(n + 444), value(n + 445), value(n + 446), value(n + 447), value(n + 448), value(n + 449),
        value(n + 450), value(n + 451), value(n + 452), value(n + 453), value(n + 454), value(n + 455), value(n + 456), value(n + 457), value(n + 458), value(n + 459),
        value(n + 460), value(n + 461), value(n + 462), value(n + 463), value(n + 464), value(n + 465), value(n + 466), value(n + 467), value(n + 468), value(n + 469),
        value(n + 470), value(n + 471), value(n + 472), value(n + 473), value(n + 474), value(n + 475), value(n + 476), value(n + 477), value(n + 478), value(n + 479),
        value(n + 480), value(n + 481), value(n + 482), value(n + 483), value(n + 484), value(n + 485), value(n + 486), value(n + 487), value(n + 488), value(n + 489),
        value(n + 490), value(n + 491), value(n + 492), value(n + 493), value(n + 494), value(n + 495), value(n + 496), value(n + 497), value(n + 498), value(n + 499),
        value(n + 500), value(n + 501), value(n + 502), value(n + 503), value(n + 504), value(n + 505), value(n + 506), value(n + 507), value(n + 508), value(n + 509),
        value(n + 510), value(n + 511), value(n + 512), value(n + 513), value(n + 514), value(n + 515), value(n + 516), value(n + 517), value(n + 518), value(n + 519),
        value(n + 520), value(n + 521), value(n + 522), value(n + 523), value(n + 524), value(n + 525), value(n + 526), value(n + 527), value(n + 528), value(n + 529),
        value(n + 530), value(n + 531), value(n + 532), value(n + 533), value(n + 534), value(n + 535), value(n + 536), value(n + 537), value(n + 538), value(n + 539),
        value(n + 540), value(n + 541), value(n + 542), value(n + 543), value(n + 544), value(n + 545), value(n + 546), value(n + 547), value(n + 548), value(n + 549),
        value(n + 550), value(n + 551), value(n + 552), value(n + 553), value(n + 554), value(n + 555), value(n + 556), value(n + 557), value(n + 558), value(n + 559),
        value(n + 560), value(n + 561), value(n + 562), value(n + 563), value(n + 564), value(n + 565), value(n + 566), value(n + 567), value(n + 568), value(n + 569),
        value(n + 570), value(n + 571), value(n + 572), value(n + 573), value(n + 574), value(n + 575), value(n + 576), value(n + 577), value(n + 578), value(n + 579),
        value(n + 580), value(n + 581), value(n + 582), value(n + 583), value(n + 584), value(n + 585), value(n + 586), value(n + 587), value(n + 588), value(n + 589),
        value(n + 590), value(n + 591), value(n + 592), value(n + 593), value(n + 594), value(n + 595), value(n + 596), value(n + 597), value(n + 598), value(n + 599),
        value(n + 600), value(n + 601), value(n + 602), value(n + 603), value(n + 604), value(n + 605), value(n + 606), value(n + 607), value(n + 608), value(n + 609),
        value(n + 610), value(n + 611), value(n + 612), value(n + 613), value(n + 614), value(n + 615), value(n + 616), value(n + 617), value(n + 618), value(n + 619),
        value(n + 620), value(n + 621), value(n + 622), value(n + 623), value(n + 624), value(n + 625), value(n + 626), value(n + 627), value(n + 628), value(n + 629),
        value(n + 630), value(n + 631), value(n + 632), value(n + 633), value(n + 634), value(n + 635), value(n + 636), value(n + 637), value(n + 638), value(n + 639),
        value(n + 640), value(n + 641), value(n + 642), value(n + 643), value(n + 644), value(n + 645), value(n + 646), value(n + 647), value(n + 648), value(n + 649),
        value(n + 650), value(n + 651), value(n + 652), value(n + 653), value(n + 654), value(n + 655), value(n + 656), value(n + 657), value(n + 658), value(n + 659),
        value(n + 660), value(n + 661), value(n + 662), value(n + 663), value(n + 664), value(n + 665), value(n + 666), value(n + 667), value(n + 668), value(n + 669),
        value(n + 670), value(n + 671), value(n + 672), value(n + 673), value(n + 674), value(n + 675), value(n + 676), value(n + 677), value(n + 678), value(n + 679),
        value(n + 680), value(n + 681), value(n + 682), value(n + 683), value(n + 684), value(n + 685), value(n + 686), value(n + 687), value(n + 688), value(n + 689),
        value(n + 690), value(n + 691), value(n + 692), value(n + 693), value(n + 694), value(n + 695), value(n + 696), value(n + 697), value(n + 698), value(n + 699),
    ];
    return values[n % values.length] + largeFrame(n + 1);
}
function rareCall(n: number, rare: number): number {
    if (n % 1000 === rare) return rareCall(n + 1000, rare) + 1;
    return n;
}
function tailStep(n: number): number {
    return growStep(n + 1);
}
function growStep(n: number): number {
    return tailStep(n + 1) + 1;
}
function throughTable(n: number): number {
    return n & 1 ? throughTable(n + 1) + 1 : table[0](n + 1) + 1;
}
const table: ((n: number) => number)[] = [throughTable];
function bounded(n: number): number {
    return n === 0 ? 0 : bounded(n - 1) + 1;
}
function attempt(run: () => number): string {
    try {
        return "returned " + run();
    } catch (error) {
        return (error as Error).name;
    }
}
console.log("small:", attempt(() => small(0)));
console.log("large frame:", attempt(() => largeFrame(0)));
console.log("rare call:", attempt(() => rareCall(7, 7)));
console.log("tail position:", attempt(() => tailStep(0)));
console.log("function value:", attempt(() => table[0](0)));
console.log("depth 5000:", attempt(() => bounded(5000)));
let sum = 0;
for (let i = 0; i < 1000; i++) sum += i;
console.log("sum:", sum);

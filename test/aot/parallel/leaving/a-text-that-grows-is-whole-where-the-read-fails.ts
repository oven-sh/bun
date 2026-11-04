// pieces have been appended in front of the point and more are appended behind it
// whoever calls goes through a name that nobody knows at build time: the function is entered by value, at its own body, and is copied into no caller
const hiddenNames = JSON.parse('["f"]');
function through<T>(f: T): T { const box: any = { f }; return ((...list: any[]) => box[hiddenNames[0]](...list)) as any; }
class Word { letters: string; constructor(letters: string) { this.letters = letters; } }
function spell(words: Word[], mark: string): string {
    let text = "<";
    for (let i = 0; i < words.length; i++) {
        text += i;
        text += mark;
        text += words[i].letters;
        text += ";";
    }
    return text + ">" + text.length;
}
const spellByValue = through(spell);
const words: any[] = [new Word("one"), new Word("two"), { letters: "three" }, new Word("four"), { letters: 5 }, { get letters() { return "six"; } }];
console.log(spellByValue(words, ":"), spellByValue(words.slice(0, 2), "-"), spellByValue(words.slice(2), ""));

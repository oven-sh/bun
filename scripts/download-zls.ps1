push-location .cache
try {
    git clone https://github.com/zigtools/zls
    set-location zls
    git pull
    # git checkout 62f17abe283bfe0ff2710c380c620a5a6e413996
    git checkout adaeabbe1ba888d74309d0a837d4abddc24cf638
    ..\zig\zig.exe build -Doptimize=ReleaseFast 
} finally { Pop-Location }

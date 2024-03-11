push-location .cache
try {
    git clone https://github.com/zigtools/zls
    set-location zls
    git checkout a6786e1c324d773f9315f44c0ad976ef192d5493
    ..\zig\zig.exe build -Doptimize=ReleaseFast 
} finally { Pop-Location }

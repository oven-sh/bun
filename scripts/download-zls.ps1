push-location .cache
try {
    git clone https://github.com/zigtools/zls
    set-location zls
    git checkout a26718049a8657d4da04c331aeced1697bc7652b
    ..\zig\zig.exe build -Doptimize=ReleaseFast 
} finally { Pop-Location }

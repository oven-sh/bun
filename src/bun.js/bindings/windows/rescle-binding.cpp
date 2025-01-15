#include "root.h"
#include "rescle.h"

extern "C" int rescle__setIcon(const WCHAR* exeFilename, const WCHAR* iconFilename)
{
    rescle::ResourceUpdater updater;
    if (!updater.Load(exeFilename))
        return -1;
    if (!updater.SetIcon(iconFilename))
        return -2;
    if (!updater.Commit())
        return -3;
    return 0;
}
